import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { writeSettings } from "@/lib/settings";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import {
  enqueueAnalysis,
  runAnalysisJob,
  pendingSegments,
  isFullDeepSession,
} from "@/lib/analysis/cascade";
import { listFindings } from "@/lib/analysis/findings";
import { listSessionFindings } from "@/lib/findings-model";
import { estimateCost } from "@/lib/analysis/cost";
import {
  monthToDateSpend,
  reserveSpend,
  finalizeReservation,
} from "@/lib/analysis/budget";
import { RATES, DEEP_MODELS, deepFullMaxMinutes, assumedFlagRate } from "@/lib/analysis/rates";
import { getItem } from "@/lib/knowledge";
import type { AudioModelClient, DeepResult } from "@/lib/analysis/audio-model";
import { DEEP_MAX_OUTPUT_TOKENS, TRIAGE_MAX_OUTPUT_TOKENS } from "@/lib/analysis/audio-model";
import { attestedCount, _resetAttestedCache } from "@/lib/lexicon/morphit";

// The richness dial (E-28, D-20/D-19): the short-capture full-deep path, the
// enriched deep output, positive production evidence, the recalibrated estimate,
// and the cross-biller pending-aware cap. A MOCK client + dummy on-disk audio — no
// network, no real model call — against a throwaway DB, like the cascade tests.

const TEMPO = 1.5;
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-richness-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a session of `count` segments each `segMs` long, with their dummy audio. */
function seed(db: Db, sessionId: string, count: number, segMs = 60_000): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  for (let idx = 0; idx < count; idx++) {
    const hash = `${sessionId}-h${idx}`;
    upsertSegment(db, { sessionId, idx, startMs: idx * segMs, endMs: idx * segMs + segMs, contentHash: hash });
    for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, idx)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
    }
  }
}

interface MockOpts {
  flag?: Set<string>; // hashes the mini flags (long path only)
  deep?: DeepResult; // what every deep call returns
}

function mockClient(opts: MockOpts = {}) {
  const calls = { triage: [] as string[], deep: [] as string[] };
  const hashOf = (b64: string) => Buffer.from(b64, "base64").toString().replace("audio-", "");
  const client: AudioModelClient = {
    async triage(input) {
      calls.triage.push(hashOf(input.audioBase64));
      return { flagged: opts.flag?.has(hashOf(input.audioBase64)) ?? false };
    },
    async deepListen(_model, input) {
      calls.deep.push(hashOf(input.audioBase64));
      return opts.deep ?? { findings: [], produced: [] };
    },
  };
  return { client, calls };
}

const oneFinding: DeepResult["findings"][number] = {
  quote: "una problema",
  correction: "un problema",
  category: "grammar",
  explanation: "gender",
  severity: "medium",
  startMs: 0,
  endMs: 0,
  relStartMs: 100,
  relEndMs: 200,
};

// ---- criterion 1: the short-capture full-deep path -----------------------

describe("short-capture full-deep path (criterion 1)", () => {
  it("a short session deep-listens 100% of segments with ZERO triage calls", async () => {
    const db = ws();
    seed(db, "short", 4); // 4 min total, well under the 30-min default
    const { client, calls } = mockClient({ deep: { findings: [oneFinding], produced: [] } });
    const job = await runAnalysisJob(db, enqueueAnalysis(db, "short").id, client, { tempo: TEMPO });
    expect(job.state).toBe("done");
    expect(calls.triage).toEqual([]); // no triage at all
    expect(calls.deep.sort()).toEqual(["short-h0", "short-h1", "short-h2", "short-h3"]); // deep on all
    expect(listFindings(db, "short")).toHaveLength(4); // one finding per segment
  });

  it("a long session still triages, deep-listening only the flagged segments", async () => {
    const db = ws();
    seed(db, "long", 3);
    // Force the long path with a 0-minute threshold (any real speech is "long").
    const { client, calls } = mockClient({ flag: new Set(["long-h1"]), deep: { findings: [oneFinding], produced: [] } });
    const job = await runAnalysisJob(db, enqueueAnalysis(db, "long").id, client, { tempo: TEMPO, deepFullMaxMinutes: 0 });
    expect(job.state).toBe("done");
    expect(calls.triage.sort()).toEqual(["long-h0", "long-h1", "long-h2"]); // triage on all
    expect(calls.deep).toEqual(["long-h1"]); // deep only on the flagged one
  });

  it("cached segments make ZERO calls on the full-deep path too", async () => {
    const db = ws();
    seed(db, "s", 3);
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep: { findings: [], produced: [] } }).client, { tempo: TEMPO });
    const spentAfterFirst = monthToDateSpend(db);
    const second = mockClient({ deep: { findings: [], produced: [] } });
    const job = await runAnalysisJob(db, enqueueAnalysis(db, "s").id, second.client, { tempo: TEMPO });
    expect(job.state).toBe("done");
    expect(second.calls.deep).toEqual([]); // nothing re-billed
    expect(second.calls.triage).toEqual([]);
    expect(monthToDateSpend(db)).toBe(spentAfterFirst);
  });

  it("isFullDeepSession is the shared short/long decision over total speech", () => {
    const segs = (mins: number) => [{ id: "x", sessionId: "s", idx: 0, startMs: 0, endMs: mins * 60_000, durationMs: mins * 60_000, contentHash: "h" }];
    expect(isFullDeepSession(segs(30), 30)).toBe(true); // ≤ threshold
    expect(isFullDeepSession(segs(31), 30)).toBe(false); // over
    expect(deepFullMaxMinutes(undefined)).toBe(30); // stated default
  });
});

// ---- criterion 2: enriched prompt + persisted enriched output ------------

describe("enriched output persists on findings (criterion 2)", () => {
  it("persists the model's notes channel, keeping only the three known fields", async () => {
    const db = ws();
    seed(db, "s", 1);
    const enriched: DeepResult = {
      findings: [
        {
          ...oneFinding,
          // A model reply with the three real fields plus a junk key that must be dropped.
          notes: { pronunciation: "geminate the t", register: "un contrattempo", disfluency: "false start", junk: "drop me" } as never,
        },
      ],
      produced: [],
    };
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep: enriched }).client, { tempo: TEMPO });
    const [f] = listFindings(db, "s");
    expect(f.notes).toEqual({ pronunciation: "geminate the t", register: "un contrattempo", disfluency: "false start" });
  });

  it("a finding with no enrichment stores null notes, not an empty object", async () => {
    const db = ws();
    seed(db, "s", 1);
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep: { findings: [oneFinding], produced: [] } }).client, { tempo: TEMPO });
    expect(listFindings(db, "s")[0].notes).toBeNull();
  });

  it("the deep output-token ceiling is generous and above the triage ceiling", () => {
    expect(DEEP_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(2000);
    expect(DEEP_MAX_OUTPUT_TOKENS).toBeGreaterThan(TRIAGE_MAX_OUTPUT_TOKENS);
  });
});

// ---- criterion 3: production lemma evidence ------------------------------

describe("production lemma evidence, validated (criterion 3)", () => {
  it("an attested produced lemma → one ×0.7 spontaneous-correct evidence row + recording mark", async () => {
    const db = ws();
    seed(db, "s", 1);
    const deep: DeepResult = { findings: [], produced: [{ lemma: "Casa", pos: "NOUN" }] }; // capitalised → lower-cased
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep }).client, { tempo: TEMPO });

    const rows = db.prepare("SELECT item_id, source, polarity, mode, weight, session_id FROM evidence").all() as {
      item_id: string; source: string; polarity: number; mode: string; weight: number; session_id: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ item_id: "lemma:casa#NOUN", source: "finding", polarity: 1, mode: "spontaneous", session_id: "s" });
    expect(rows[0].weight).toBeCloseTo(0.7, 6); // spontaneous 1.0 × 0.7 audio discount

    const item = getItem(db, "lemma:casa#NOUN")!;
    expect(item.recordingAttested).toBe(true); // marked for the composer to exclude
  });

  it("an unattested produced lemma is dropped — no item, no evidence", async () => {
    const db = ws();
    seed(db, "s", 1);
    const deep: DeepResult = { findings: [], produced: [{ lemma: "zzzfoo", pos: "NOUN" }, { lemma: "casa", pos: "BOGUS" }] };
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep }).client, { tempo: TEMPO });
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM knowledge_items").get() as { n: number }).n).toBe(0);
  });

  it("cache reuse into another session does NOT re-record produced evidence", async () => {
    const db = ws();
    seed(db, "s1", 1); // hash s1-h0
    // Point both sessions at the SAME content hash so s2 is a cache hit of s1.
    createSession(db, { id: "s2", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    upsertSegment(db, { sessionId: "s2", idx: 0, startMs: 0, endMs: 60_000, contentHash: "s1-h0" });
    for (const p of [renditionCachePath("s1-h0", TEMPO), segmentPath("s2", 0)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from("audio-s1-h0"));
    }
    const deep: DeepResult = { findings: [], produced: [{ lemma: "mangiare", pos: "VERB" }] };
    await runAnalysisJob(db, enqueueAnalysis(db, "s1").id, mockClient({ deep }).client, { tempo: TEMPO });
    const dup = mockClient({ deep });
    await runAnalysisJob(db, enqueueAnalysis(db, "s2").id, dup.client, { tempo: TEMPO });
    expect(dup.calls.deep).toEqual([]); // cache hit — no deep call
    // The one evidence row is from s1 only; the duplicate did not mint a second.
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(1);
  });
});

// ---- criterion 4: recalibrated rates; estimate matches the billed set -----

describe("recalibrated rates and a truthful full-deep estimate (criterion 4)", () => {
  it("the deep rate is recalibrated to ~half the founding figure", () => {
    expect(RATES["gpt-audio-1.5"].usdPerAudioMinute).toBeCloseTo(0.03, 9); // was 0.06
    expect(assumedFlagRate(undefined)).toBeCloseTo(0.5, 9); // loosened companion (D-20)
  });

  it("the full-deep estimate equals the run's real billed set, and cached segments never re-bill", async () => {
    const db = ws();
    seed(db, "s", 5); // 5 min, short → full-deep
    const pending = pendingSegments(db, "s").map((seg) => ({ durationMs: seg.durationMs }));
    const estimate = estimateCost(pending, { tempo: TEMPO, fullDeep: true });
    expect(estimate.miniUsd).toBe(0); // no triage on the full-deep path
    expect(estimate.deepUsd).toBeGreaterThan(0);

    const job = await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep: { findings: [], produced: [] } }).client, { tempo: TEMPO });
    expect(job.state).toBe("done");
    const billed = monthToDateSpend(db);
    expect(billed).toBeCloseTo(estimate.totalUsd, 9); // the estimate never understated the real cost

    // A second run is a pure cache hit — the estimate falls to zero and nothing re-bills.
    expect(pendingSegments(db, "s")).toHaveLength(0);
    const second = mockClient({ deep: { findings: [], produced: [] } });
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, second.client, { tempo: TEMPO });
    expect(second.calls.deep).toEqual([]);
    expect(monthToDateSpend(db)).toBeCloseTo(billed, 9);
  });
});

// ---- criterion 5a: the morph-it asset loads independent of cwd -----------

describe("deploy-safe morph-it asset load (criterion 5a)", () => {
  it("loads relative to the module, not process.cwd()", () => {
    _resetAttestedCache();
    const original = process.cwd();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "erika-cwd-"));
    try {
      process.chdir(elsewhere); // a cwd that is NOT the repo — a cwd-relative read would ENOENT
      expect(attestedCount()).toBeGreaterThan(30_000); // still loads from the module-relative path
    } finally {
      process.chdir(original);
      fs.rmSync(elsewhere, { recursive: true, force: true });
      _resetAttestedCache();
    }
  });
});

// ---- criterion 5b: cross-biller pending-aware budget cap ------------------

describe("cross-biller pending-aware cap (criterion 5b)", () => {
  it("a render refuses when a cascade reservation leaves no room; committed never exceeds the cap", async () => {
    const db = ws();
    const { renderCorrection, BudgetExceededError } = await import("@/lib/render/engine");
    const { getIncludedFinding } = await import("@/lib/findings-model");
    const { persistSegmentFindings } = await import("@/lib/analysis/findings");

    const CAP = 0.02;
    writeSettings(db, { monthlyBudgetUsd: CAP });
    createSession(db, { id: "s", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    persistSegmentFindings(db, {
      sessionId: "s",
      contentHash: "s-h",
      flagged: true,
      deepDone: true,
      findings: [{ quote: "q", correction: "una correzione", category: "grammar", explanation: "e", severity: "low", startMs: 0, endMs: 1 }],
    });
    const finding = getIncludedFinding(db, (db.prepare("SELECT id FROM findings").get() as { id: string }).id)!;

    // A cascade deep reservation is IN FLIGHT (pending), leaving almost no headroom.
    const reservation = reserveSpend(db, { model: "gpt-audio-1.5", contentHash: "cascade-h", costUsd: CAP - 0.00001 }, CAP)!;
    expect(reservation).not.toBeNull();

    const synth = { calls: 0, async synthesize() { this.calls++; return { audio: Buffer.from("x"), format: "mp3" }; } };
    // The render's tiny cost cannot fit under the pending cascade reservation, so the
    // pending-aware reserve refuses it — no call, no committed row.
    await expect(renderCorrection(db, synth, finding)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(synth.calls).toBe(0); // never called the provider
    expect(monthToDateSpend(db)).toBe(0); // nothing committed by the render

    // Finalize the cascade reservation → committed lands, still within the cap.
    finalizeReservation(db, reservation, reservation.costUsd);
    expect(monthToDateSpend(db)).toBeLessThanOrEqual(CAP + 1e-9);
    // No stray pending row from the refused render survives.
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number }).n).toBe(0);
  });

  it("a render's in-flight reservation is visible to a concurrent cascade reserve", async () => {
    const db = ws();
    const CAP = 0.02;
    writeSettings(db, { monthlyBudgetUsd: CAP });
    // A render-sized reservation holds most of the cap (pending, not yet committed).
    const held = reserveSpend(db, { model: "gpt-4o-mini-tts", contentHash: "render-h", costUsd: CAP - 0.00001 }, CAP)!;
    expect(held).not.toBeNull();
    // The cascade's reserve now sees committed + pending and is refused — it cannot
    // reserve on top of the in-flight render and overshoot.
    expect(reserveSpend(db, { model: "gpt-audio-1.5", contentHash: "cascade-h", costUsd: 0.01 }, CAP)).toBeNull();
    // Only ever ONE pending row; committed is still zero.
    expect(monthToDateSpend(db)).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number }).n).toBe(1);
  });
});

// A guard so the DEEP_MODELS ordering the recalibration touched is still intact.
describe("deep model chain unchanged", () => {
  it("primary then D-3 fallback", () => {
    expect(DEEP_MODELS).toEqual(["gpt-audio-1.5", "gpt-audio"]);
  });
});

// listSessionFindings still returns notes through the E-17 scope (spot-check).
describe("enriched notes survive the findings-model read (E-17)", () => {
  it("a full-deep finding's notes read back through listSessionFindings", async () => {
    const db = ws();
    seed(db, "s", 1);
    const deep: DeepResult = { findings: [{ ...oneFinding, notes: { register: "cogliere l'occasione" } }], produced: [] };
    await runAnalysisJob(db, enqueueAnalysis(db, "s").id, mockClient({ deep }).client, { tempo: TEMPO });
    const [f] = listSessionFindings(db, "s");
    expect(f.notes).toEqual({ register: "cogliere l'occasione" });
  });
});
