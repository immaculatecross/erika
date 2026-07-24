import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { writeSettings } from "@/lib/settings";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { enqueueAnalysis, runAnalysisJob } from "@/lib/analysis/cascade";
import { listFindings } from "@/lib/analysis/findings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { reclaimStale } from "@/lib/jobs/lease";
import type { AudioModelClient } from "@/lib/analysis/audio-model";

// E-27 — the parallel cascade: a bounded pool overlaps model calls (criteria 1 & 6),
// the budget cap stays hard with the whole pool racing (criterion 2, end-to-end),
// and a long parallel run keeps its lease fresh so it is never reclaimed mid-flight
// (criterion 4). Mock client + dummy on-disk audio; no network, no ffmpeg.

const TEMPO = 1.5;
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-conc-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seed(db: Db, sessionId: string, count: number): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
  for (let idx = 0; idx < count; idx++) {
    const hash = `${sessionId}-h${idx}`;
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    for (const p of [renditionCachePath(hash, TEMPO), segmentPath(sessionId, idx)]) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("bounded per-segment concurrency (criterion 1) with real overlap (criterion 6)", () => {
  it("never runs more than N model calls in flight, and does overlap them", async () => {
    const db = ws();
    seed(db, "s1", 12);
    let inFlight = 0;
    let maxInFlight = 0;
    const observe = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(5); // hold the slot so siblings pile up if the pool lets them
      inFlight -= 1;
    };
    const N = 3;
    const client: AudioModelClient = {
      async triage() {
        await observe();
        return { flagged: true }; // flag all → each segment also deep-listens
      },
      async deepListen() {
        await observe();
        return { findings: [] };
      },
    };

    const job = enqueueAnalysis(db, "s1");
    const done = await runAnalysisJob(db, job.id, client, { tempo: TEMPO, concurrency: N });
    expect(done.state).toBe("done");
    expect(maxInFlight).toBeLessThanOrEqual(N); // the cap held...
    expect(maxInFlight).toBeGreaterThanOrEqual(2); // ...and the pool genuinely overlapped
    db.close();
  });
});

describe("the cap is hard with the whole pool racing (criterion 2, end-to-end)", () => {
  it("admits exactly what fits, halts, and never commits past the cap", async () => {
    const db = ws();
    seed(db, "s1", 20);
    // Each all-clear segment costs one mini call: 60s / 1.5 = 40s compressed at
    // $0.006/min = $0.004. A $0.02 cap fits exactly 5; 8 workers race for them.
    writeSettings(db, { monthlyBudgetUsd: 0.02 });
    let triageCalls = 0;
    const client: AudioModelClient = {
      async triage() {
        triageCalls += 1;
        await sleep(2); // let racers pile onto the reservation gate
        return { flagged: false };
      },
      async deepListen() {
        return { findings: [] };
      },
    };

    const job = enqueueAnalysis(db, "s1");
    // Pin the cascade path (`deepFullMaxMinutes: 0`): this test's cap-hardness math
    // is built on the mini triage cost, and a short session would otherwise take the
    // full-deep path (no triage) under E-28. The reservation gate it proves is the same.
    const done = await runAnalysisJob(db, job.id, client, { tempo: TEMPO, concurrency: 8, deepFullMaxMinutes: 0 });
    expect(done.state).toBe("halted");
    expect(triageCalls).toBe(5); // only the 5 that reserved ever called the model
    expect(monthToDateSpend(db)).toBeCloseTo(0.02, 9); // exactly the cap...
    expect(monthToDateSpend(db)).toBeLessThanOrEqual(0.02 + 1e-9); // ...never a cent over
    // No pending reservation lingers: winners finalized, the refused made no row.
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='pending'").get() as { n: number }).n).toBe(0);
    db.close();
  });
});

describe("interval heartbeat keeps a long parallel run un-reclaimed (criterion 4)", () => {
  it("the lease stays fresh across a run longer than the stale threshold", async () => {
    const db = ws();
    seed(db, "s1", 1);
    // The single deep call runs ~2.5 s — longer than the 1.5 s stale threshold we
    // probe with. WITHOUT an interval heartbeat (the old per-segment beat, once at
    // the start) the lease would age past the threshold during this one long call
    // and a sibling worker would steal it. The 200 ms interval keeps it fresh.
    let reclaimedMidRun: string[] | null = null;
    const client: AudioModelClient = {
      async triage() {
        return { flagged: true };
      },
      async deepListen() {
        await sleep(2500);
        // A would-be reclaimer using a 1.5 s stale threshold finds the lease fresh.
        reclaimedMidRun = reclaimStale(db, "analysis_jobs", "worker-thief", 1500);
        return { findings: [] };
      },
    };

    const job = enqueueAnalysis(db, "s1");
    const done = await runAnalysisJob(db, job.id, client, { tempo: TEMPO, heartbeatMs: 200 });
    expect(done.state).toBe("done");
    expect(reclaimedMidRun).toEqual([]); // never reclaimable mid-flight
    expect(listFindings(db, "s1")).toHaveLength(0);
    db.close();
  }, 10_000);
});
