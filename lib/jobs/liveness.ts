import type { Db } from "../db";
import { JOB_LEASE_STALE_MS, type JobTable } from "./lease-config";

// "Nothing is happening" made visible (E-16b criterion 2).
//
// The operator uploaded a recording and it sat `queued` forever; clicking Analyze
// queued a second job that also sat. Both were behaving exactly as designed — the
// work is done by a SEPARATE process (`npm run worker`) — but the UI showed a calm
// badge and never said so, so the app looked broken rather than un-started.
//
// The signal is the heartbeat lease from part 1 (./lease.ts). A live worker polls
// the queue about once a second and beats on whatever it claims, so:
//
//   * a job still `queued` well past that poll interval means nothing is draining
//     the queue — no worker is running;
//   * a `processing` job whose heartbeat has gone stale means the worker that held
//     it is gone. This uses the SAME threshold as reclaim, deliberately: the UI
//     must not call a worker dead while the reclaimer still considers it alive.

/**
 * How long a job may sit `queued` before we conclude no worker is draining the
 * queue. A running worker claims the oldest queued row within one poll (~1 s), so
 * 20 s is two orders of magnitude of slack — it will not fire on a busy worker,
 * and it fires long before a person gives up waiting.
 */
export const QUEUED_STALE_MS = 20_000;

/** The line the UI shows. Plain, actionable, and states the exact command. */
export const WORKER_ABSENT_MESSAGE =
  "Not processing — start the worker with `npm run worker`.";

/** The timestamps a liveness verdict is made from (SQLite UTC text, or null). */
export interface JobTimes {
  state: string;
  createdAt: string | null;
  updatedAt: string | null;
  heartbeatAt: string | null;
}

/** SQLite's `datetime('now')` text ("YYYY-MM-DD HH:MM:SS", UTC) → epoch ms. */
export function parseSqliteTime(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pure verdict: is there no worker behind this job? True only for a job that
 * should be moving and demonstrably is not. A terminal job (done/failed/halted)
 * is never "waiting on a worker", and a job whose timestamps are unreadable gets
 * the benefit of the doubt — a false alarm telling someone to start a worker that
 * is already running is worse than a moment's silence.
 */
export function workerAbsent(
  job: JobTimes,
  nowMs: number,
  opts: { queuedStaleMs?: number; leaseStaleMs?: number } = {},
): boolean {
  const queuedStaleMs = opts.queuedStaleMs ?? QUEUED_STALE_MS;
  const leaseStaleMs = opts.leaseStaleMs ?? JOB_LEASE_STALE_MS;

  if (job.state === "queued") {
    const since = parseSqliteTime(job.updatedAt) ?? parseSqliteTime(job.createdAt);
    return since !== null && nowMs - since > queuedStaleMs;
  }
  if (job.state === "processing") {
    // A NULL heartbeat is a pre-v8 row: it carries no live lease, so fall back to
    // the row's own clock exactly as `reclaimStale` does.
    const beat = parseSqliteTime(job.heartbeatAt) ?? parseSqliteTime(job.updatedAt);
    return beat !== null && nowMs - beat > leaseStaleMs;
  }
  return false;
}

/** The same verdict for a stored job — the read routes' one-liner. */
export function isWorkerAbsent(db: Db, table: JobTable, jobId: string, nowMs = Date.now()): boolean {
  const r = db
    .prepare(`SELECT state, created_at, updated_at, heartbeat_at FROM ${table} WHERE id = ?`)
    .get(jobId) as
    | { state: string; created_at: string | null; updated_at: string | null; heartbeat_at: string | null }
    | undefined;
  if (!r) return false;
  return workerAbsent(
    { state: r.state, createdAt: r.created_at, updatedAt: r.updated_at, heartbeatAt: r.heartbeat_at },
    nowMs,
  );
}
