import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { claimNextJob, getJob, reclaimStuckJobs } from "@/lib/ingest/pipeline";
import { claimNextAnalysisJob, enqueueAnalysis, reclaimStuckAnalysisJobs } from "@/lib/analysis/cascade";
import { persistSegmentFindings, listFindings, type NewFinding } from "@/lib/analysis/findings";
import { getLease, heartbeat, JOB_LEASE_STALE_MS, type JobTable } from "@/lib/jobs/lease";

// The worker's job-selection logic (no ffmpeg): atomic queued→processing claim,
// and — E-16 defect 2 — the heartbeat lease that makes crash recovery pick up
// only ABANDONED jobs, never one a live worker is still executing.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-worker-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seedSession(db: ReturnType<typeof openDatabase>, id: string): string {
  createSession(db, { id, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 1 });
  const jobId = (db.prepare("SELECT id FROM ingest_jobs WHERE session_id = ?").get(id) as { id: string }).id;
  // Give the job a distinct created_at so "oldest queued" is unambiguous.
  db.prepare("UPDATE ingest_jobs SET created_at = ? WHERE id = ?").run(`2020-01-01 00:00:0${id}`, jobId);
  return jobId;
}

/** Age a job's heartbeat by `ms` — simulates a worker that stopped beating. */
function staleLease(
  db: ReturnType<typeof openDatabase>,
  jobId: string,
  ms: number,
  table: JobTable = "ingest_jobs",
): void {
  db.prepare(`UPDATE ${table} SET heartbeat_at = datetime('now', ?) WHERE id = ?`).run(
    `-${Math.round(ms / 1000)} seconds`,
    jobId,
  );
}

describe("worker job selection", () => {
  it("claims the oldest queued job atomically and marks it processing", () => {
    const db = freshDb();
    const j1 = seedSession(db, "1");
    const j2 = seedSession(db, "2");
    const first = claimNextJob(db);
    expect(first).toBe(j1); // oldest by created_at
    expect(getJob(db, j1)?.state).toBe("processing");
    expect(getJob(db, j1)?.stage).toBe("normalizing");
    const second = claimNextJob(db);
    expect(second).toBe(j2);
    expect(claimNextJob(db)).toBeNull(); // queue drained
    db.close();
  });

  it("does NOT reclaim a job whose lease is still being beaten on (defect 2)", () => {
    const db = freshDb();
    const j1 = seedSession(db, "1");
    seedSession(db, "2");
    claimNextJob(db, "worker-A"); // A is running j1 right now

    // The bug: reclaim returned EVERY 'processing' row with no staleness check,
    // and scripts/worker.ts reclaims on every tick — so worker B re-ran the job A
    // was actively executing (double OpenAI spend, duplicate findings).
    expect(reclaimStuckJobs(db, "worker-B")).toEqual([]);
    expect(getLease(db, "ingest_jobs", j1)?.workerId).toBe("worker-A"); // lease untouched

    // A heartbeat mid-flight keeps it that way.
    heartbeat(db, "ingest_jobs", j1);
    expect(reclaimStuckJobs(db, "worker-B")).toEqual([]);
    db.close();
  });

  it("reclaims a job whose lease has gone stale, transferring ownership", () => {
    const db = freshDb();
    const j1 = seedSession(db, "1");
    claimNextJob(db, "worker-A");
    // A died: its heartbeat stops. Age it past the lease window.
    staleLease(db, j1, JOB_LEASE_STALE_MS + 60_000);

    expect(reclaimStuckJobs(db, "worker-B")).toEqual([j1]);
    expect(getLease(db, "ingest_jobs", j1)?.workerId).toBe("worker-B"); // ownership moved
    // ...and having taken it, B's own fresh heartbeat protects it from a third worker.
    expect(reclaimStuckJobs(db, "worker-C")).toEqual([]);
    db.close();
  });

  it("a stale analysis job is reclaimable but a live one is not", () => {
    const db = freshDb();
    createSession(db, { id: "a1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 1 });
    const job = enqueueAnalysis(db, "a1");
    expect(claimNextAnalysisJob(db, "worker-A")).toBe(job.id);
    expect(reclaimStuckAnalysisJobs(db, "worker-B")).toEqual([]); // live — hands off
    staleLease(db, job.id, JOB_LEASE_STALE_MS + 60_000, "analysis_jobs");
    expect(reclaimStuckAnalysisJobs(db, "worker-B")).toEqual([job.id]);
    db.close();
  });
});

// Scope note: this guard makes a REPLAYED write idempotent. It does not prevent
// the double-run race — two independent model replies disagree on offsets and
// wording, so both persist. The heartbeat lease above is what prevents that.
describe("findings identity guard (defect 2, belt-and-braces)", () => {
  it("re-writing the identical finding inserts it once, not twice", () => {
    const db = freshDb();
    createSession(db, { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    const findings: NewFinding[] = [
      {
        quote: "I have 25 years",
        correction: "I am 25 years old",
        category: "grammar",
        explanation: "why",
        severity: "medium",
        startMs: 1000,
        endMs: 2000,
      },
    ];
    const write = () =>
      persistSegmentFindings(db, {
        sessionId: "s1",
        contentHash: "h",
        flagged: true,
        deepDone: true,
        findings,
        spend: { model: "gpt-audio-1.5", contentHash: "h", costUsd: 0.01 },
      });

    write();
    write(); // the exact same write, replayed

    // The finding is not duplicated...
    expect(listFindings(db, "s1")).toHaveLength(1);
    // ...though both real calls are still on the ledger: two calls, two charges.
    expect(db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get()).toEqual({ n: 2 });
    db.close();
  });
});
