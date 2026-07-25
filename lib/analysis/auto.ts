import type { Db } from "../db";
import { monthToDateSpend } from "./budget";
import { enqueueAnalysis, type AnalysisJob } from "./cascade";
import { readSettings } from "../settings";
import { hasAnalysisKey, isMissingKeyMessage } from "../env-file";

// ANALYSIS STARTS ITSELF (E-42 criterion 3, D-26).
//
// Before this, the browser was the thing that started an analysis: the learner had
// to notice ingest had finished (the home never polled), press Analyze, read an
// estimate, and press Start. Closing the tab between those steps stranded the
// session forever, and the commonest real behaviour — record, put the laptop down —
// was exactly the behaviour that guaranteed no findings.
//
// So the enqueue moves to where ingest COMPLETES, server-side, with no client
// present. `enqueueAfterIngest` is called from the ingest pipeline's done
// transition, inside the same transaction, so a session cannot reach `done` without
// its analysis being queued. `sweepPendingAnalysis` is the invariant behind the
// instance: the worker runs it every tick, so a session that completed ingest
// through any other path — a pre-E-42 row, a crash between the two writes, a job
// completed by a test harness — still gets its run.
//
// THE OPPOSITE FAILURE, asked before the fix was written: what does over-enqueueing
// look like? It looks like money. So the rule is narrow and idempotent — a session
// gets an automatic run only if it has speech to analyse and has NO analysis job of
// any state. A `failed` job (no API key) is not retried into a loop; a `done` job is
// not re-run; a `halted` job is resumed by `resumeHaltedAnalysis` below, which
// re-queues the SAME job rather than minting a second one.

/** A session whose ingest finished with speech but which has no analysis job yet. */
const PENDING_SQL = `
  SELECT s.id AS id
    FROM sessions s
    JOIN ingest_jobs j ON j.session_id = s.id AND j.state = 'done'
   WHERE EXISTS (SELECT 1 FROM segments sg WHERE sg.session_id = s.id)
     AND NOT EXISTS (SELECT 1 FROM analysis_jobs a WHERE a.session_id = s.id)
   ORDER BY j.created_at, s.id
`;
// Ordered by the INGEST JOB's age — the order work became ready — and deliberately
// not by anything about the session's own timeline. This is a queue, so "oldest
// pending work first" is the rule; neither when the learner spoke nor when the row
// was written is the question being asked (E-42 criterion 6's opposite failure:
// swapping every timestamp for the capture instant would be just as wrong as
// reading the upload instant for a capture claim).

/** Does this session have speech AND no analysis job at all? */
function needsAutomaticRun(db: Db, sessionId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok
         FROM sessions s
        WHERE s.id = ?
          AND EXISTS (SELECT 1 FROM segments sg WHERE sg.session_id = s.id)
          AND NOT EXISTS (SELECT 1 FROM analysis_jobs a WHERE a.session_id = s.id)`,
    )
    .get(sessionId) as { ok: number } | undefined;
  return row !== undefined;
}

/**
 * Queue this session's analysis now that its ingest is done — the one call the
 * pipeline makes on its `done` transition (criterion 3). Returns the job, or null
 * when there is nothing to analyse (no speech) or a run already exists.
 *
 * A session with ZERO segments is deliberately skipped: a run over no audio costs
 * nothing, finishes instantly and reports "no findings", which reads as a clean
 * bill of health on speech no model ever heard (the E-16b criterion 5 lie, and the
 * same gate the POST route enforces with a 409).
 *
 * Budget is NOT checked here. At the cap the run is still queued and the worker
 * halts it at the first refused reservation, having made zero calls — that is what
 * lets the session be HELD and resumed rather than failed (criterion 8). Checking
 * here would silently drop the session on the floor instead.
 */
export function enqueueAfterIngest(db: Db, sessionId: string): AnalysisJob | null {
  if (!needsAutomaticRun(db, sessionId)) return null;
  return enqueueAnalysis(db, sessionId);
}

/**
 * Queue an automatic run for EVERY session whose ingest finished with speech and
 * which has no analysis job — the invariant, not the instance. Returns the session
 * ids it queued. Idempotent: a second call queues nothing.
 */
export function sweepPendingAnalysis(db: Db): string[] {
  const rows = db.prepare(PENDING_SQL).all() as { id: string }[];
  const queued: string[] = [];
  for (const r of rows) {
    if (enqueueAfterIngest(db, r.id)) queued.push(r.id);
  }
  return queued;
}

/**
 * How long a halted run waits before the worker offers it another chance.
 *
 * A halt costs nothing (a refused reservation makes no call), so re-queueing is
 * safe — but with headroom smaller than the cheapest call, halt → re-queue → halt
 * would spin every tick. One attempt a minute per job is invisible to a learner who
 * has just raised their budget and free of the churn. Kept as a named constant, and
 * injectable, so the resume test does not sleep.
 */
export const HALTED_RETRY_COOLDOWN_MS = 60_000;

/**
 * Re-queue analysis runs the budget cap halted, once there is headroom again
 * (criterion 8: "it resumes when headroom exists without the learner re-uploading").
 *
 * `halted` is otherwise terminal — `claimQueued` only takes `queued` and
 * `reclaimStale` only takes `processing` — so before this a capped session stayed
 * stopped even after the month rolled over or the budget was raised, and the only
 * way forward was to upload the recording again. Resuming the SAME job is what makes
 * that unnecessary: the cascade is checkpointed and hash-cached, so a resumed run
 * re-bills nothing it already paid for and picks up at the segment that was refused.
 *
 * Headroom is committed-only spend against the cap, the same figure Settings shows.
 * At or over the cap this returns nothing at all, so the cap still holds.
 */
export function resumeHaltedAnalysis(
  db: Db,
  opts: { cooldownMs?: number; now?: Date } = {},
): string[] {
  const cooldownMs = opts.cooldownMs ?? HALTED_RETRY_COOLDOWN_MS;
  const { monthlyBudgetUsd } = readSettings(db);
  if (monthToDateSpend(db) >= monthlyBudgetUsd - 1e-9) return []; // still capped
  const cutoff = (
    db
      .prepare("SELECT datetime('now', ?) AS c")
      .get(`-${Math.max(0, Math.round(cooldownMs / 1000))} seconds`) as { c: string }
  ).c;
  const rows = db
    .prepare(
      `SELECT id FROM analysis_jobs
        WHERE state = 'halted' AND COALESCE(updated_at, created_at) <= ?
        ORDER BY created_at, id`,
    )
    .all(cutoff) as { id: string }[];
  const resumed: string[] = [];
  for (const r of rows) {
    // Clear the halt message with the state: a resumed run that still says "monthly
    // budget reached" would be a stale claim on a job that is running again.
    const info = db
      .prepare(
        "UPDATE analysis_jobs SET state = 'queued', error = NULL, updated_at = datetime('now') WHERE id = ? AND state = 'halted'",
      )
      .run(r.id);
    if (info.changes > 0) resumed.push(r.id);
  }
  return resumed;
}

/**
 * Re-queue analysis runs that were refused for want of an API key, once a key
 * exists. Returns the job ids it re-queued.
 *
 * THIS IS THE OPPOSITE FAILURE OF THE ONE ABOVE IT, and it was found by driving the
 * built app rather than by reading the diff. Refusing a keyless analysis job
 * *terminally, per job* is right — it is what stops the worker looping on a wall that
 * will not move (RETRO-004 §DE-1). But `failed` is terminal for the claim AND the
 * reclaim, so a learner who did the exact thing the UI told them to do — add the key,
 * restart the worker — came back to a recording still saying "waiting for an API key",
 * with no way to run it and no button to press, because this milestone deliberately
 * removed the Analyze button that used to be their escape.
 *
 * So the wall moves when the reason for it moves. The gate is narrow in both
 * directions: nothing is re-queued while there is still no key, and only jobs whose
 * stored error IS the missing-key message are touched — a run that failed for any
 * other reason stays failed and keeps its own message, which is what the detail
 * page's "Try again" repair (criterion 10) is for. It cannot spin: with a key
 * present the job actually runs, and if it then fails it fails with a different
 * error that this predicate does not match.
 */
export function resumeKeylessRefusals(db: Db): string[] {
  if (!hasAnalysisKey()) return []; // the condition is unchanged; leave them alone
  const rows = db
    .prepare("SELECT id, error FROM analysis_jobs WHERE state = 'failed' ORDER BY created_at, id")
    .all() as { id: string; error: string | null }[];
  const resumed: string[] = [];
  for (const r of rows) {
    if (!isMissingKeyMessage(r.error)) continue;
    const info = db
      .prepare(
        "UPDATE analysis_jobs SET state = 'queued', error = NULL, updated_at = datetime('now') WHERE id = ? AND state = 'failed'",
      )
      .run(r.id);
    if (info.changes > 0) resumed.push(r.id);
  }
  return resumed;
}
