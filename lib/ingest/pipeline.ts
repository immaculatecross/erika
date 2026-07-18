import { stat } from "node:fs/promises";
import type { Db } from "../db";
import { getSession } from "../sessions";
import {
  ensureSegmentsDir,
  normalizedPath,
  segmentPath,
  sourcePath,
} from "../audio-storage";
import { getSegmentByIndex, listSegments, upsertSegment } from "../segments";
import { normalize } from "./normalize";
import { detectSpeech, type Interval } from "./vad";
import { extractSegment, hashFile, renderRendition, triageTempo } from "./render";
import { claimQueued, heartbeat, reclaimStale, workerId } from "../jobs/lease";

// The heart of E-3 (D-10): drain a queued capture into stored, deduplicated,
// pre-rendered speech segments — resumably and without ever holding a whole
// recording in memory. `processJob` is the testable unit; scripts/worker.ts is a
// thin loop around it. Every audio op is ffmpeg file→file (see ./normalize,
// ./vad, ./render); this module only orchestrates and checkpoints.

/** Fine-grained pipeline checkpoint, persisted on ingest_jobs.stage. */
export const STAGES = ["normalizing", "detecting", "segmenting", "rendering", "done"] as const;
export type Stage = (typeof STAGES)[number];

/** Progress recorded once each stage completes. */
const STAGE_PROGRESS: Record<Stage, number> = {
  normalizing: 0.25,
  detecting: 0.4,
  segmenting: 0.7,
  rendering: 0.95,
  done: 1,
};

export interface IngestJob {
  id: string;
  sessionId: string;
  state: "queued" | "processing" | "done" | "failed";
  stage: Stage | null;
  progress: number;
  error: string | null;
}

interface JobRow {
  id: string;
  session_id: string;
  state: IngestJob["state"];
  stage: Stage | null;
  progress: number;
  error: string | null;
}

function toJob(r: JobRow): IngestJob {
  return { id: r.id, sessionId: r.session_id, state: r.state, stage: r.stage, progress: r.progress, error: r.error };
}

export function getJob(db: Db, id: string): IngestJob | null {
  const r = db
    .prepare("SELECT id, session_id, state, stage, progress, error FROM ingest_jobs WHERE id = ?")
    .get(id) as JobRow | undefined;
  return r ? toJob(r) : null;
}

/**
 * The ingest job for a session (one per session). Read accessor for the UI —
 * the detail page surfaces state/stage/progress/error without knowing the job id.
 */
export function getJobBySession(db: Db, sessionId: string): IngestJob | null {
  const r = db
    .prepare("SELECT id, session_id, state, stage, progress, error FROM ingest_jobs WHERE session_id = ?")
    .get(sessionId) as JobRow | undefined;
  return r ? toJob(r) : null;
}

function patchJob(db: Db, id: string, p: Partial<Pick<JobRow, "state" | "stage" | "progress" | "error">>): void {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  cols.push("updated_at = datetime('now')");
  db.prepare(`UPDATE ingest_jobs SET ${cols.join(", ")} WHERE id = ?`).run(...vals, id);
}

export interface ProcessOpts {
  /** Override the validated triage tempo (else from TRIAGE_TEMPO / default). */
  tempo?: number;
  /** Stop right after this stage completes, leaving the job in `processing`. */
  stopAfter?: Stage;
}

/**
 * Run (or resume) one ingest job to completion. Advances state
 * queued → processing → done, checkpointing `stage`/`progress` after each step.
 * Resumable: a crashed job re-enters at its recorded stage — a finished
 * normalize is skipped, and already-persisted segments are neither re-extracted
 * nor duplicated. On any failure the job lands `failed` with a truthful error
 * and is never marked done. Returns the final job. Does not throw on pipeline
 * failure — the failure is recorded on the row.
 */
export async function processJob(db: Db, jobId: string, opts: ProcessOpts = {}): Promise<IngestJob> {
  const job = getJob(db, jobId);
  if (!job) throw new Error(`No ingest job ${jobId}.`);
  if (job.state === "done") return job;

  const session = getSession(db, job.sessionId);
  if (!session) throw new Error(`Job ${jobId} references missing session ${job.sessionId}.`);

  const tempo = opts.tempo ?? triageTempo();
  const from = job.stage ?? "normalizing";
  patchJob(db, jobId, { state: "processing", stage: from, error: null });

  const source = sourcePath(session.id, session.format);
  const normalized = normalizedPath(session.id);

  try {
    if (atOrBefore(from, "normalizing")) {
      await normalize(source, normalized);
      if (checkpoint(db, jobId, "detecting", opts.stopAfter, "normalizing")) return getJob(db, jobId)!;
    }

    // Detection is cheap and deterministic, so it is recomputed on resume rather
    // than persisted — this never redoes the expensive extraction/rendering.
    const intervals = await detectSpeech(normalized);

    if (atOrBefore(from, "segmenting")) {
      await segmentAll(db, jobId, session.id, normalized, intervals);
      if (checkpoint(db, jobId, "rendering", opts.stopAfter, "segmenting")) return getJob(db, jobId)!;
    }

    if (atOrBefore(from, "rendering")) {
      await renderAll(db, jobId, session.id, tempo);
      if (checkpoint(db, jobId, "done", opts.stopAfter, "rendering")) return getJob(db, jobId)!;
    }

    patchJob(db, jobId, { state: "done", stage: "done", progress: 1, error: null });
  } catch (err) {
    patchJob(db, jobId, { state: "failed", error: (err as Error).message || "Ingest failed." });
  }
  return getJob(db, jobId)!;
}

/** Extract + hash + persist each interval, skipping any already on disk. */
async function segmentAll(
  db: Db,
  jobId: string,
  sessionId: string,
  normalized: string,
  intervals: Interval[],
): Promise<void> {
  await ensureSegmentsDir(sessionId);
  for (let idx = 0; idx < intervals.length; idx++) {
    const iv = intervals[idx];
    heartbeat(db, "ingest_jobs", jobId); // still alive — do not reclaim this job
    const file = segmentPath(sessionId, idx);
    if (getSegmentByIndex(db, sessionId, idx) && (await fileExists(file))) continue; // resume: skip done work
    await extractSegment(normalized, iv.startMs, iv.endMs, file);
    const contentHash = await hashFile(file);
    upsertSegment(db, { sessionId, idx, startMs: iv.startMs, endMs: iv.endMs, contentHash });
  }
}

/** Render each segment's cached triage rendition (cache hit ⇒ no re-render). */
async function renderAll(db: Db, jobId: string, sessionId: string, tempo: number): Promise<void> {
  for (const seg of listSegments(db, sessionId)) {
    heartbeat(db, "ingest_jobs", jobId);
    await renderRendition(segmentPath(sessionId, seg.idx), seg.contentHash, tempo);
  }
}

/** Advance the checkpoint (beating the lease); true if opts asked to stop here. */
function checkpoint(db: Db, jobId: string, next: Stage, stopAfter: Stage | undefined, justDid: Stage): boolean {
  patchJob(db, jobId, { stage: next, progress: STAGE_PROGRESS[justDid] });
  heartbeat(db, "ingest_jobs", jobId);
  return stopAfter === justDid;
}

function atOrBefore(from: Stage, target: Stage): boolean {
  return STAGES.indexOf(from) <= STAGES.indexOf(target);
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Atomically claim the oldest queued job (queued → processing) under a heartbeat
 * lease and return its id, or null if none. The transaction stops two workers
 * grabbing one queued row; the lease (E-16 defect 2) stops a second worker
 * reclaiming it while this one is still running it.
 */
export function claimNextJob(db: Db, worker: string = workerId()): string | null {
  return claimQueued(db, "ingest_jobs", worker, "normalizing");
}

/**
 * Ids of jobs a crashed worker left mid-flight — that is, `processing` rows whose
 * lease has gone stale (no heartbeat for JOB_LEASE_STALE_MS). A job a live worker
 * is actively beating on is NOT returned: reclaiming it would re-run work already
 * in flight and bill OpenAI twice. Reclaiming transfers the lease to `worker`.
 */
export function reclaimStuckJobs(db: Db, worker: string = workerId()): string[] {
  return reclaimStale(db, "ingest_jobs", worker);
}
