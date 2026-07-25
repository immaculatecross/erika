import type { Db } from "../db";

// The analysis job row's shape and its one write primitive, extracted from
// lib/analysis/cascade.ts (the 500-line cap). Nothing here orchestrates or bills —
// it is the `analysis_jobs` read/write vocabulary the cascade, the routes and the
// worker share, so a caller that only needs to move a job's state does not have to
// pull in the whole cascade.

export type AnalysisState = "queued" | "processing" | "done" | "failed" | "halted";

export interface AnalysisJob {
  id: string;
  sessionId: string;
  state: AnalysisState;
  stage: string | null;
  progress: number;
  error: string | null;
}

export interface JobRow {
  id: string;
  session_id: string;
  state: AnalysisState;
  stage: string | null;
  progress: number;
  error: string | null;
}

export const SELECT_JOB = "SELECT id, session_id, state, stage, progress, error FROM analysis_jobs";

export function toJob(r: JobRow): AnalysisJob {
  return { id: r.id, sessionId: r.session_id, state: r.state, stage: r.stage, progress: r.progress, error: r.error };
}

export function getAnalysisJob(db: Db, id: string): AnalysisJob | null {
  const r = db.prepare(`${SELECT_JOB} WHERE id = ?`).get(id) as JobRow | undefined;
  return r ? toJob(r) : null;
}

/** Move a job's state/stage/progress/error, always stamping `updated_at`. */
export function patchJob(
  db: Db,
  id: string,
  p: Partial<Pick<JobRow, "state" | "stage" | "progress" | "error">>,
): void {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  cols.push("updated_at = datetime('now')");
  db.prepare(`UPDATE analysis_jobs SET ${cols.join(", ")} WHERE id = ?`).run(...vals, id);
}

/**
 * Land one analysis job in `failed` with a stated reason, doing no work.
 *
 * [RETRO-004 §DE-1] The worker calls this when a claimed analysis job cannot possibly
 * succeed — today, only when there is no API key. It is a TERMINAL, per-job refusal:
 * `failed` is claimed by neither `claimNextAnalysisJob` (queued only) nor
 * `reclaimStuckAnalysisJobs` (stale `processing` only), so there is no retry loop, the
 * worker stays up, and the ingest queue keeps draining behind it. Refusing out here
 * rather than inside the cascade keeps the cascade honest about its own seam: it knows
 * an injected `AudioModelClient`, never an environment variable.
 */
export function failAnalysisJob(db: Db, jobId: string, reason: string): AnalysisJob | null {
  if (!getAnalysisJob(db, jobId)) return null;
  patchJob(db, jobId, { state: "failed", error: reason });
  return getAnalysisJob(db, jobId);
}
