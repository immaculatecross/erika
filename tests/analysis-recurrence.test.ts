import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { enqueueAnalysis, runAnalysisJob } from "@/lib/analysis/cascade";
import { listFindings, persistSegmentFindings } from "@/lib/analysis/findings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { collectSpeakerProfile } from "@/lib/analysis/profile";
import type { AudioModelClient, DeepResult, TriageInput } from "@/lib/analysis/audio-model";

// E-19 criteria 3–4 against the cascade: the deep reply's optional recurrence
// reference is persisted when it cites a real profile entry, ignored (never
// fatal) otherwise — and priming the prompts with the profile changes NOTHING
// about spend: the same calls, the same ledger rows, and cached segments still
// re-bill nothing, because the profile is not part of the cache identity.

const TEMPO = 1.5;
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-recur-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a session with 60s segments + dummy audio (the cascade-test harness). */
function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
  hashes.forEach((hash, idx) => {
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, idx)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
    }
  });
}

const RECURRING_CORRECTION = "ho 25 anni";

/**
 * Plant an analysed history whose findings make ONE recurring profile entry
 * (R1 → RECURRING_CORRECTION): two findings sharing a correction, committed
 * with their witness so they are "included" — no model call, no ledger row.
 */
function seedHistory(db: Db): void {
  createSession(db, { id: "hist", originalFilename: "h.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
  upsertSegment(db, { sessionId: "hist", idx: 0, startMs: 0, endMs: 60_000, contentHash: "hhist" });
  persistSegmentFindings(db, {
    sessionId: "hist",
    contentHash: "hhist",
    flagged: true,
    deepDone: true,
    findings: [
      { quote: "io ho 25 anni", correction: RECURRING_CORRECTION, category: "grammar", explanation: "e", severity: "high", startMs: 0, endMs: 500 },
      { quote: "ho venticinque anno", correction: RECURRING_CORRECTION, category: "grammar", explanation: "e", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
}

function mockClient(opts: { flag: Set<string>; deepFindings?: DeepResult["findings"] }) {
  const calls = { triage: [] as string[], deep: [] as string[] };
  const seen = { triageInputs: [] as TriageInput[] };
  const client: AudioModelClient = {
    async triage(input) {
      const hash = Buffer.from(input.audioBase64, "base64").toString().replace("audio-", "");
      calls.triage.push(hash);
      seen.triageInputs.push(input);
      return { flagged: opts.flag.has(hash) };
    },
    async deepListen(_model, input) {
      const hash = Buffer.from(input.audioBase64, "base64").toString().replace("audio-", "");
      calls.deep.push(hash);
      return {
        findings: opts.deepFindings ?? [
          { quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "medium", startMs: 0, endMs: 0, relStartMs: 1000, relEndMs: 2000 },
        ],
      };
    },
  };
  return { client, calls, seen };
}

function run(db: Db, sessionId: string, client: AudioModelClient) {
  const job = enqueueAnalysis(db, sessionId);
  return runAnalysisJob(db, job.id, client, { tempo: TEMPO });
}

const deepFinding = (extra: Partial<DeepResult["findings"][number]>) => [
  { quote: "q", correction: "c", category: "grammar" as const, explanation: "e", severity: "medium" as const, startMs: 0, endMs: 0, relStartMs: 1000, relEndMs: 2000, ...extra },
];

describe("migration v10", () => {
  it("adds nullable recurrence_of to findings, additively", () => {
    const db = ws();
    const cols = db.prepare("PRAGMA table_info(findings)").all() as { name: string; notnull: number }[];
    const col = cols.find((c) => c.name === "recurrence_of");
    expect(col).toBeDefined();
    expect(col!.notnull).toBe(0); // optional everywhere (D-13)
    db.close();
  });
});

describe("recurrence marking is persisted (criterion 3)", () => {
  it("a deep reply citing a valid profile entry persists the link", async () => {
    const db = ws();
    seedHistory(db);
    expect(collectSpeakerProfile(db).entries[0]).toMatchObject({ id: "R1", correction: RECURRING_CORRECTION });

    seed(db, "s1", ["h1"]);
    const { client } = mockClient({ flag: new Set(["h1"]), deepFindings: deepFinding({ recurrenceId: "R1" }) });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");

    const [finding] = listFindings(db, "s1");
    expect(finding.recurrenceOf).toBe(RECURRING_CORRECTION);
    const raw = db.prepare("SELECT recurrence_of FROM findings WHERE session_id = 's1'").get() as { recurrence_of: string };
    expect(raw.recurrence_of).toBe(RECURRING_CORRECTION);
    db.close();
  });

  it("a reply without the field persists exactly as today (null link)", async () => {
    const db = ws();
    seedHistory(db);
    seed(db, "s1", ["h1"]);
    const { client } = mockClient({ flag: new Set(["h1"]), deepFindings: deepFinding({}) });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");
    const [finding] = listFindings(db, "s1");
    expect(finding).toMatchObject({ quote: "q", recurrenceOf: null });
    db.close();
  });

  it("an unknown reference is ignored — the finding still persists, the run still finishes", async () => {
    const db = ws();
    seedHistory(db);
    seed(db, "s1", ["h1"]);
    const { client } = mockClient({ flag: new Set(["h1"]), deepFindings: deepFinding({ recurrenceId: "R99" }) });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");
    expect(job.error).toBeNull();
    const [finding] = listFindings(db, "s1");
    expect(finding).toMatchObject({ quote: "q", recurrenceOf: null });
    db.close();
  });

  it("cache reuse into another session clones the recurrence link", async () => {
    const db = ws();
    seedHistory(db);
    seed(db, "s1", ["h1"]);
    await run(db, "s1", mockClient({ flag: new Set(["h1"]), deepFindings: deepFinding({ recurrenceId: "R1" }) }).client);

    seed(db, "s2", ["h1"]); // identical audio → pure cache hit
    const dup = mockClient({ flag: new Set(["h1"]) });
    await run(db, "s2", dup.client);
    expect(dup.calls.triage).toEqual([]);
    expect(dup.calls.deep).toEqual([]);
    expect(listFindings(db, "s2")[0].recurrenceOf).toBe(RECURRING_CORRECTION);
    db.close();
  });
});

describe("profile injection changes no spend behavior (criterion 4)", () => {
  it("the primed run makes the same calls and ledger rows as the cascade always did", async () => {
    const db = ws();
    seedHistory(db); // non-empty profile, injected into every prompt below
    seed(db, "s1", ["h0", "h1"]);

    const first = mockClient({ flag: new Set(["h1"]) });
    const job = await run(db, "s1", first.client);
    expect(job.state).toBe("done");
    // The profile genuinely rode along on every call...
    expect(first.seen.triageInputs.every((i) => i.profile?.entries[0]?.id === "R1")).toBe(true);
    // ...and the call/ledger shape is exactly the pre-E-19 one: 2 triages + 1 deep.
    expect(first.calls.triage.sort()).toEqual(["h0", "h1"]);
    expect(first.calls.deep).toEqual(["h1"]);
    const rows = db.prepare("SELECT model FROM spend_ledger ORDER BY model").all() as { model: string }[];
    expect(rows.map((r) => r.model)).toEqual(["gpt-audio-1.5", "gpt-audio-mini", "gpt-audio-mini"]);
    db.close();
  });

  it("cached segments are never re-billed, even after the profile has changed", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1"]);
    await run(db, "s1", mockClient({ flag: new Set(["h1"]) }).client); // analysed with an empty profile
    const spend = monthToDateSpend(db);
    const ledgerRows = (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;

    seedHistory(db); // the profile GROWS between runs — the prompts would differ...
    const second = mockClient({ flag: new Set(["h1"]) });
    const job = await run(db, "s1", second.client);
    expect(job.state).toBe("done");
    // ...but the cache identity is the audio's content hash, so: zero calls,
    // zero new rows, not a cent re-billed.
    expect(second.calls.triage).toEqual([]);
    expect(second.calls.deep).toEqual([]);
    expect(monthToDateSpend(db)).toBe(spend);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(ledgerRows);
    db.close();
  });
});
