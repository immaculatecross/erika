import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { writeSettings } from "@/lib/settings";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { enqueueAnalysis, runAnalysisJob, pendingSegments } from "@/lib/analysis/cascade";
import { listFindings } from "@/lib/analysis/findings";
import { monthToDateSpend, recordSpend } from "@/lib/analysis/budget";
import {
  type AudioModelClient,
  type DeepResult,
  ModelParseError,
  ModelUnavailableError,
  parseDeepResponse,
} from "@/lib/analysis/audio-model";

// The cascade against a MOCK client + dummy on-disk audio (no network, no
// ffmpeg): criterion 1 (cascade shape), 2 (persist / no-partial-write), 4 (never
// re-bill cached hashes), 6 (budget cap halts before the over-cap call).

const TEMPO = 1.5;
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-cascade-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a session with `hashes.length` 60s segments and their dummy audio files. */
function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
  hashes.forEach((hash, idx) => {
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    // The mock ignores audio bytes; the cascade only needs the files to exist.
    for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, idx)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
    }
  });
}

interface MockOpts {
  /** Hashes the mini flags; every other hash is all-clear. */
  flag: Set<string>;
  /** Findings the deep model returns for a flagged hash (default: one). */
  deepFindings?: DeepResult["findings"];
  /** If set, deepListen throws this instead of returning. */
  deepThrows?: Error;
}

function mockClient(opts: MockOpts) {
  const calls = { triage: [] as string[], deep: [] as string[] };
  const client: AudioModelClient = {
    async triage(input) {
      // Recover the hash from our dummy "audio-<hash>" payload (base64-decoded).
      const hash = Buffer.from(input.audioBase64, "base64").toString().replace("audio-", "");
      calls.triage.push(hash);
      return { flagged: opts.flag.has(hash) };
    },
    async deepListen(_model, input) {
      const hash = Buffer.from(input.audioBase64, "base64").toString().replace("audio-", "");
      calls.deep.push(hash);
      if (opts.deepThrows) throw opts.deepThrows;
      return {
        findings: opts.deepFindings ?? [
          {
            quote: "a mistake",
            correction: "a correction",
            category: "grammar",
            explanation: "why",
            severity: "medium",
            startMs: 0,
            endMs: 0,
            relStartMs: 1000,
            relEndMs: 2000,
          },
        ],
      };
    },
  };
  return { client, calls };
}

function run(db: Db, sessionId: string, client: AudioModelClient) {
  const job = enqueueAnalysis(db, sessionId);
  return runAnalysisJob(db, job.id, client, { tempo: TEMPO });
}

describe("cascade shape (criterion 1)", () => {
  it("triages every segment, deep-listens only the flagged ones", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1", "h2"]);
    const { client, calls } = mockClient({ flag: new Set(["h1"]) });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");
    expect(calls.triage.sort()).toEqual(["h0", "h1", "h2"]); // mini on all
    expect(calls.deep).toEqual(["h1"]); // deep only on the flagged one
    db.close();
  });
});

describe("findings persistence (criterion 2)", () => {
  // Regression for the identity key: `quote` names the erroneous SPAN, not the
  // finding, and `relStartMs` is OPTIONAL in the deep-response contract — the
  // parser accepts a reply without offsets and toTimeline anchors it at the
  // segment start. So two genuinely different findings on one utterance share a
  // (session, hash, start_ms, quote) key. A key that narrow drops the second
  // silently: the job still lands `done` and the call is still billed in full.
  it("keeps two distinct findings that share a quote and a start_ms", async () => {
    const db = ws();
    seed(db, "s1", ["h0"]);
    // A deep reply the SHIPPED parser accepts as fully valid — same quote, two
    // categories, two corrections, no offsets at all.
    const { findings } = parseDeepResponse(
      JSON.stringify({
        findings: [
          {
            quote: "I have 25 years",
            correction: "I am 25 years old",
            category: "grammar",
            explanation: "age takes 'to be' in English",
            severity: "high",
          },
          {
            quote: "I have 25 years",
            correction: "I am twenty-five years old",
            category: "pronunciation",
            explanation: "the numeral is clipped",
            severity: "medium",
          },
        ],
      }),
    );
    expect(findings.every((f) => f.relStartMs === undefined)).toBe(true);

    const { client } = mockClient({ flag: new Set(["h0"]), deepFindings: findings });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("done");

    const persisted = listFindings(db, "s1");
    expect(persisted).toHaveLength(2); // both, not one
    expect(persisted.map((f) => f.category).sort()).toEqual(["grammar", "pronunciation"]);
    expect(new Set(persisted.map((f) => f.startMs))).toEqual(new Set([0])); // same span
    db.close();
  });

  it("persists parsed findings with timeline-absolute timestamps", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1"]); // h1 at segment start 60_000ms
    const { client } = mockClient({ flag: new Set(["h1"]) });
    await run(db, "s1", client);
    const findings = listFindings(db, "s1");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ category: "grammar", severity: "medium", contentHash: "h1" });
    // rel 1000–2000 within the segment starting at 60_000 → absolute 61_000–62_000.
    expect(findings[0].startMs).toBe(61_000);
    expect(findings[0].endMs).toBe(62_000);
    db.close();
  });

  it("a deep parse failure fails the job and writes no partial findings", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1"]);
    const { client } = mockClient({ flag: new Set(["h1"]), deepThrows: new ModelParseError("garbage") });
    const job = await run(db, "s1", client);
    expect(job.state).toBe("failed");
    expect(job.error).toMatch(/garbage/);
    expect(listFindings(db, "s1")).toEqual([]); // nothing half-written
    db.close();
  });
});

describe("never re-bill cached segments (criterion 4)", () => {
  it("a second run over the same hashes makes zero calls and leaves the ledger unchanged", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1"]);
    const first = mockClient({ flag: new Set(["h1"]) });
    await run(db, "s1", first.client);
    const spendAfterFirst = monthToDateSpend(db);
    expect(first.calls.triage.length + first.calls.deep.length).toBeGreaterThan(0);

    const second = mockClient({ flag: new Set(["h1"]) });
    const job = await run(db, "s1", second.client);
    expect(job.state).toBe("done");
    expect(second.calls.triage).toEqual([]); // zero mini calls
    expect(second.calls.deep).toEqual([]); // zero deep calls
    expect(monthToDateSpend(db)).toBe(spendAfterFirst); // ledger unchanged
    db.close();
  });

  it("a duplicate segment in another session reuses findings with no new calls", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]); // flagged, produces a finding
    await run(db, "s1", mockClient({ flag: new Set(["h1"]) }).client);
    const ledgerAfterS1 = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };

    seed(db, "s2", ["h1"]); // identical audio, different session
    const dup = mockClient({ flag: new Set(["h1"]) });
    await run(db, "s2", dup.client);
    expect(dup.calls.triage).toEqual([]);
    expect(dup.calls.deep).toEqual([]);
    // s2 got the cached finding reused, and no new ledger row was written.
    expect(listFindings(db, "s2")).toHaveLength(1);
    const ledgerAfterS2 = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
    expect(ledgerAfterS2.n).toBe(ledgerAfterS1.n);
    db.close();
  });
});

/** Seed a session carrying ONE segment of `hash` at an explicit timeline offset. */
function seedAt(db: Db, sessionId: string, hash: string, startMs: number, durationMs = 4000): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 7200 });
  upsertSegment(db, { sessionId, idx: 0, startMs, endMs: startMs + durationMs, contentHash: hash });
  for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, 0)]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
  }
}

describe("cache reuse remaps timestamps onto the target segment (E-16 defect 1)", () => {
  // The donor finding's start_ms/end_ms are absolute offsets on the DONOR's
  // timeline. Cloning them verbatim into a session where the identical audio sits
  // an hour later produced a finding at 11 s — outside the target segment
  // entirely, so jump-to-audio, the archive and the timeline all pointed at the
  // wrong moment (or at nothing). What the two segments share is the offset
  // WITHIN the segment; that is what must survive the clone.
  it("an offset-shifted duplicate lands inside the target segment, not the donor's", async () => {
    const db = ws();
    seedAt(db, "donor", "hd", 10_000); // donor segment at 10–14 s
    await run(db, "donor", mockClient({ flag: new Set(["hd"]) }).client);
    const donorFinding = listFindings(db, "donor")[0];
    expect(donorFinding.startMs).toBe(11_000); // rel 1000 within a segment at 10_000
    expect(donorFinding.endMs).toBe(12_000);

    // Byte-identical audio, one hour into a different session.
    seedAt(db, "target", "hd", 3_600_000);
    const dup = mockClient({ flag: new Set(["hd"]) });
    const job = await run(db, "target", dup.client);
    expect(job.state).toBe("done");
    expect(dup.calls.triage).toEqual([]); // still a cache hit — zero calls
    expect(dup.calls.deep).toEqual([]);

    const reused = listFindings(db, "target");
    expect(reused).toHaveLength(1);
    // The same 1 s offset, re-anchored at the TARGET segment's start.
    expect(reused[0].startMs).toBe(3_601_000); // was 11_000 before the fix
    expect(reused[0].endMs).toBe(3_602_000);
    // ...and, stated as the invariant that actually matters:
    expect(reused[0].startMs).toBeGreaterThanOrEqual(3_600_000);
    expect(reused[0].endMs).toBeLessThanOrEqual(3_604_000);
    db.close();
  });

  it("a same-offset duplicate is unchanged", async () => {
    const db = ws();
    seedAt(db, "donor", "hd", 10_000);
    await run(db, "donor", mockClient({ flag: new Set(["hd"]) }).client);
    seedAt(db, "twin", "hd", 10_000); // identical audio at the identical offset
    await run(db, "twin", mockClient({ flag: new Set(["hd"]) }).client);
    expect(listFindings(db, "twin")[0]).toMatchObject({ startMs: 11_000, endMs: 12_000 });
    db.close();
  });

  it("clamps a donor finding that would land past the target segment's end", async () => {
    const db = ws();
    seedAt(db, "donor", "hd", 10_000, 60_000); // a long donor segment
    const late = mockClient({
      flag: new Set(["hd"]),
      deepFindings: [
        {
          quote: "late",
          correction: "fixed",
          category: "grammar",
          explanation: "why",
          severity: "low",
          startMs: 0,
          endMs: 0,
          relStartMs: 50_000, // 50 s into the donor segment
          relEndMs: 52_000,
        },
      ],
    });
    await run(db, "donor", late.client);
    expect(listFindings(db, "donor")[0].startMs).toBe(60_000);

    // The target segment for the same hash is only 4 s long: the offset cannot
    // fit, so it is clamped to the target's bounds rather than escaping them.
    seedAt(db, "short", "hd", 3_600_000, 4000);
    await run(db, "short", mockClient({ flag: new Set(["hd"]) }).client);
    const f = listFindings(db, "short")[0];
    expect(f.startMs).toBe(3_604_000); // clamped to the segment end
    expect(f.endMs).toBe(3_604_000);
    db.close();
  });
});

describe("spend is recorded when a call resolves, not after parsing (E-16 defect 4)", () => {
  // A 200 that fails to parse charged OpenAI while the ledger recorded nothing —
  // so the retry billed again and the "hard cap" capped only *recorded* money,
  // understating spend exactly when things were going wrong.
  it("a deep call that resolves but fails to parse still ledgers its cost", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]); // one 60 s segment, flagged
    const { client } = mockClient({ flag: new Set(["h1"]), deepThrows: new ModelParseError("garbage") });
    const job = await run(db, "s1", client);

    expect(job.state).toBe("failed");
    expect(listFindings(db, "s1")).toEqual([]); // still nothing half-written
    const rows = db.prepare("SELECT model, cost_usd FROM spend_ledger ORDER BY model").all() as {
      model: string;
      cost_usd: number;
    }[];
    // The mini triage (which parsed fine) AND the unparseable deep call.
    expect(rows.map((r) => r.model)).toEqual(["gpt-audio-1.5", "gpt-audio-mini"]);
    // 60 s of deep audio at $0.06/min = $0.06 — the real charge, not zero.
    expect(rows[0].cost_usd).toBeCloseTo(0.06, 9);
    db.close();
  });

  it("a network failure records nothing — no completion, no charge", async () => {
    const db = ws();
    seed(db, "s1", ["h1"]);
    const { client } = mockClient({
      flag: new Set(["h1"]),
      deepThrows: new ModelUnavailableError("connection reset"),
    });
    await run(db, "s1", client);
    // Only the mini's successful triage is on the ledger; the deep call is not.
    const models = (db.prepare("SELECT model FROM spend_ledger").all() as { model: string }[]).map((r) => r.model);
    expect(models).toEqual(["gpt-audio-mini"]);
    db.close();
  });
});

describe("budget cap halts truthfully (criterion 6)", () => {
  it("halts before the over-budget call and never bills past the cap", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1", "h2"]);
    // Cap $0.02; each 60s mini call costs $0.004 (40s compressed × $0.006/min).
    // Seed $0.012 so two more calls fit (→ $0.020, the cap) and the third would
    // cross — the run must stop before billing it.
    writeSettings(db, { monthlyBudgetUsd: 0.02 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "seed", costUsd: 0.012 });

    const { client, calls } = mockClient({ flag: new Set() }); // all-clear (mini only)
    const job = await run(db, "s1", client);
    expect(job.state).toBe("halted");
    expect(job.error).toMatch(/budget/i);
    expect(calls.triage.length).toBeGreaterThan(0); // some calls fit
    expect(calls.triage.length).toBeLessThan(3); // ...but it stopped before the last
    expect(monthToDateSpend(db)).toBeLessThanOrEqual(0.02 + 1e-9); // never over the cap
    db.close();
  });

  it("pendingSegments shrinks as segments get cached", async () => {
    const db = ws();
    seed(db, "s1", ["h0", "h1"]);
    expect(pendingSegments(db, "s1")).toHaveLength(2);
    await run(db, "s1", mockClient({ flag: new Set(["h1"]) }).client);
    expect(pendingSegments(db, "s1")).toHaveLength(0);
    db.close();
  });
});
