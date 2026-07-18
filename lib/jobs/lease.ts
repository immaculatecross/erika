import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import { JOB_LEASE_STALE_MS, type JobTable } from "./lease-config";

// The heartbeat lease shared by both job queues (E-16 defect 2, migration v8).
//
// Before this, `reclaimStuckJobs` / `reclaimStuckAnalysisJobs` returned EVERY row
// in `processing` with no staleness check, and scripts/worker.ts reclaims on every
// tick — so a second worker process happily re-ran a job the first was still
// executing: double OpenAI spend, duplicate findings, doubled cards, inflated
// metrics. A claim now stamps the claiming worker's identity and a heartbeat, the
// running job refreshes that heartbeat at every checkpoint, and reclaim takes only
// rows whose heartbeat has gone stale. A live job is therefore untouchable; a
// genuinely abandoned one is still recovered, which is what crash recovery meant.
//
// Both queues share this module rather than each growing its own copy — the two
// tables have the same lease shape (`state`/`worker_id`/`heartbeat_at`).

// The staleness threshold and the table union live in ./lease-config so a client
// component can import them without pulling node:crypto into the bundle.
export { JOB_LEASE_STALE_MS, type JobTable } from "./lease-config";

let processWorkerId: string | null = null;

/** This process's stable lease identity — one id for the worker's whole life. */
export function workerId(): string {
  if (!processWorkerId) processWorkerId = `${process.pid}-${randomUUID().slice(0, 8)}`;
  return processWorkerId;
}

/**
 * Claim the oldest queued job for `worker`, stamping the lease. Returns its id, or
 * null when the queue is empty. The transaction is what stops two workers taking
 * the same queued row; the lease is what stops them colliding once it is running.
 */
export function claimQueued(db: Db, table: JobTable, worker: string, stage: string): string | null {
  return db.transaction(() => {
    const row = db
      .prepare(`SELECT id FROM ${table} WHERE state = 'queued' ORDER BY created_at, id LIMIT 1`)
      .get() as { id: string } | undefined;
    if (!row) return null;
    db.prepare(
      `UPDATE ${table}
         SET state = 'processing', stage = ?, error = NULL,
             worker_id = ?, heartbeat_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
    ).run(stage, worker, row.id);
    return row.id;
  })();
}

/**
 * Take over every `processing` job whose lease has gone stale, and return their
 * ids. Ownership transfers inside the transaction — the reclaimer stamps itself
 * and a fresh heartbeat — so two workers reclaiming at once cannot both win the
 * same row. A NULL heartbeat is a pre-v8 row: no live lease, so reclaimable.
 */
export function reclaimStale(
  db: Db,
  table: JobTable,
  worker: string,
  staleMs: number = JOB_LEASE_STALE_MS,
): string[] {
  const cutoff = `-${Math.round(staleMs / 1000)} seconds`;
  return db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT id FROM ${table}
          WHERE state = 'processing'
            AND COALESCE(heartbeat_at, updated_at, created_at) <= datetime('now', ?)
          ORDER BY created_at, id`,
      )
      .all(cutoff) as { id: string }[];
    const take = db.prepare(
      `UPDATE ${table} SET worker_id = ?, heartbeat_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?`,
    );
    for (const r of rows) take.run(worker, r.id);
    return rows.map((r) => r.id);
  })();
}

/**
 * Refresh a running job's heartbeat — "still alive, do not reclaim me". Called at
 * every checkpoint the job passes. Cheap (one indexed UPDATE by primary key), so
 * beating often is free; it is the only thing keeping a long job un-stolen.
 */
export function heartbeat(db: Db, table: JobTable, jobId: string): void {
  db.prepare(`UPDATE ${table} SET heartbeat_at = datetime('now') WHERE id = ?`).run(jobId);
}

/** The lease a job currently carries — for tests and diagnostics. */
export function getLease(db: Db, table: JobTable, jobId: string): { workerId: string | null; heartbeatAt: string | null } | null {
  const r = db.prepare(`SELECT worker_id, heartbeat_at FROM ${table} WHERE id = ?`).get(jobId) as
    | { worker_id: string | null; heartbeat_at: string | null }
    | undefined;
  return r ? { workerId: r.worker_id, heartbeatAt: r.heartbeat_at } : null;
}
