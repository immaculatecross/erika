import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Db } from "../db";
import { getSession } from "../sessions";
import { readSettings } from "../settings";
import { listSegments, type Segment } from "../segments";
import { renditionCachePath, segmentPath } from "../audio-storage";
import { triageTempo } from "../ingest/render";
import {
  type AudioModelClient,
  type DeepInput,
  ModelParseError,
  ModelUnavailableError,
} from "./audio-model";
import { claimQueued, heartbeat, reclaimStale, workerId } from "../jobs/lease";
import {
  getSegmentAnalysis,
  isSegmentComplete,
  persistSegmentFindings,
  reuseCachedFindings,
  type NewFinding,
} from "./findings";
import { callCost, DEEP_MODELS, MINI_MODEL, type ModelId } from "./rates";
import { recordSpend, wouldExceedBudget } from "./budget";

/** One real billable call: recorded atomically with the segment it completes. */
type SpendEntry = { model: ModelId; contentHash: string; costUsd: number };

// The two-stage cascade (D-10, D-3): for each speech segment, `gpt-audio-mini`
// triages the time-compressed rendition; only a *flagged* segment is deep-listened
// at native speed by `gpt-audio-1.5` (fallback `gpt-audio`). Findings are cached
// by content hash so identical audio is analyzed once, ever, and a hard monthly
// budget cap halts the run before any over-cap call. The model itself is injected
// as `AudioModelClient`, so this whole orchestration is unit-tested against a mock.

export type AnalysisState = "queued" | "processing" | "done" | "failed" | "halted";

export interface AnalysisJob {
  id: string;
  sessionId: string;
  state: AnalysisState;
  stage: string | null;
  progress: number;
  error: string | null;
}

interface JobRow {
  id: string;
  session_id: string;
  state: AnalysisState;
  stage: string | null;
  progress: number;
  error: string | null;
}

const SELECT_JOB = "SELECT id, session_id, state, stage, progress, error FROM analysis_jobs";

function toJob(r: JobRow): AnalysisJob {
  return { id: r.id, sessionId: r.session_id, state: r.state, stage: r.stage, progress: r.progress, error: r.error };
}

export function getAnalysisJob(db: Db, id: string): AnalysisJob | null {
  const r = db.prepare(`${SELECT_JOB} WHERE id = ?`).get(id) as JobRow | undefined;
  return r ? toJob(r) : null;
}

/** The most recent analysis job for a session (the run the UI reflects). */
export function getAnalysisJobBySession(db: Db, sessionId: string): AnalysisJob | null {
  const r = db
    .prepare(`${SELECT_JOB} WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`)
    .get(sessionId) as JobRow | undefined;
  return r ? toJob(r) : null;
}

/** A queued or processing run for this session, if one is already in flight. */
export function getActiveAnalysisJob(db: Db, sessionId: string): AnalysisJob | null {
  const r = db
    .prepare(`${SELECT_JOB} WHERE session_id = ? AND state IN ('queued','processing') ORDER BY created_at, id LIMIT 1`)
    .get(sessionId) as JobRow | undefined;
  return r ? toJob(r) : null;
}

/** Enqueue an analysis run, reusing an in-flight one rather than duplicating it. */
export function enqueueAnalysis(db: Db, sessionId: string): AnalysisJob {
  const active = getActiveAnalysisJob(db, sessionId);
  if (active) return active;
  const id = randomUUID();
  db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES (?, ?, 'queued')").run(id, sessionId);
  return getAnalysisJob(db, id)!;
}

function patchJob(db: Db, id: string, p: Partial<Pick<JobRow, "state" | "stage" | "progress" | "error">>): void {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(p)) {
    cols.push(`${k} = ?`);
    vals.push(v);
  }
  cols.push("updated_at = datetime('now')");
  db.prepare(`UPDATE analysis_jobs SET ${cols.join(", ")} WHERE id = ?`).run(...vals, id);
}

/** Atomically claim the oldest queued analysis job under a heartbeat lease, or null. */
export function claimNextAnalysisJob(db: Db, worker: string = workerId()): string | null {
  return claimQueued(db, "analysis_jobs", worker, "analyzing");
}

/**
 * Ids of analysis jobs a crashed worker left mid-flight — `processing` rows whose
 * lease has gone stale. A job a live worker is still beating on is NOT returned:
 * re-running it would re-triage and re-deep-listen segments already in flight,
 * billing OpenAI a second time for the same audio (E-16 defect 2).
 */
export function reclaimStuckAnalysisJobs(db: Db, worker: string = workerId()): string[] {
  return reclaimStale(db, "analysis_jobs", worker);
}

/** Internal signal: month-to-date + this call would breach the budget cap. */
class BudgetHalt extends Error {}

async function fileBase64(path: string): Promise<string> {
  // Reads one segment's audio at a time — bounded per call, never the whole
  // recording. base64 inflates by ~4/3; a multi-minute mono clip stays small.
  return (await readFile(path)).toString("base64");
}

/** Map a deep finding's clip-relative offsets onto the session timeline. */
function toTimeline(seg: Segment, f: NewFinding & { relStartMs?: number; relEndMs?: number }): NewFinding {
  const dur = seg.endMs - seg.startMs;
  const rs = f.relStartMs !== undefined ? Math.min(Math.max(f.relStartMs, 0), dur) : 0;
  const re = f.relEndMs !== undefined ? Math.min(Math.max(f.relEndMs, rs), dur) : dur;
  return {
    quote: f.quote,
    correction: f.correction,
    category: f.category,
    explanation: f.explanation,
    severity: f.severity,
    startMs: seg.startMs + rs,
    endMs: seg.startMs + re,
  };
}

/**
 * Run one billable model call and guarantee the charge is ledgered the moment the
 * call *resolves* — not only when its response parses (E-16 defect 4).
 *
 * A `ModelParseError` means OpenAI answered (and charged) but the body was not
 * the shape we asked for. Recording nothing there let the retry bill again while
 * the "hard cap" capped only *recorded* money — it understated spend precisely
 * when things were going wrong. A `ModelUnavailableError` is the opposite case:
 * a network failure or a non-2xx, no completion, no charge, so nothing is written.
 *
 * The success path is deliberately untouched: it returns without writing, and its
 * spend is still committed by `persistSegmentFindings` in ONE transaction with the
 * findings and the witness (E-4 criterion 5). The two guarantees are disjoint —
 * this records only on the failure path, where there is no witness to commit with.
 */
async function billedCall<T>(db: Db, spend: SpendEntry, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof ModelParseError) recordSpend(db, spend);
    throw err;
  }
}

async function runDeep(
  db: Db,
  client: AudioModelClient,
  seg: Segment,
  input: DeepInput,
  budget: number,
): Promise<{ findings: NewFinding[]; spend: SpendEntry }> {
  let lastErr: Error | undefined;
  for (const model of DEEP_MODELS as readonly ModelId[]) {
    const cost = callCost(model, seg.durationMs);
    if (wouldExceedBudget(db, cost, budget)) throw new BudgetHalt();
    try {
      const spend: SpendEntry = { model, contentHash: seg.contentHash, costUsd: cost };
      const res = await billedCall(db, spend, () => client.deepListen(model, input));
      // Spend is not recorded here — it is committed atomically with the findings
      // and witness by the caller, so a crash between the two can never re-bill.
      return { findings: res.findings.map((f) => toTimeline(seg, f)), spend };
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        lastErr = err; // try the D-3 fallback model before giving up
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new ModelUnavailableError("No deep-listen model available.");
}

export interface RunOpts {
  /** Override the triage tempo (else from TRIAGE_TEMPO); must match E-3's. */
  tempo?: number;
}

/**
 * Run (or resume) one analysis job. Advances queued → processing → done; on a
 * budget breach lands `halted` (findings so far kept, cap never exceeded); on any
 * other failure lands `failed` with a truthful message. Cached segments make zero
 * model calls and record nothing. Does not throw on run failure — it is recorded.
 */
export async function runAnalysisJob(
  db: Db,
  jobId: string,
  client: AudioModelClient,
  opts: RunOpts = {},
): Promise<AnalysisJob> {
  const job = getAnalysisJob(db, jobId);
  if (!job) throw new Error(`No analysis job ${jobId}.`);
  if (job.state === "done") return job;

  const session = getSession(db, job.sessionId);
  if (!session) throw new Error(`Job ${jobId} references missing session ${job.sessionId}.`);

  const { targetLanguage, monthlyBudgetUsd: budget } = readSettings(db);
  const tempo = opts.tempo ?? triageTempo();
  const segments = listSegments(db, job.sessionId);
  patchJob(db, jobId, { state: "processing", stage: "analyzing", error: null });

  try {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const hash = seg.contentHash;
      heartbeat(db, "analysis_jobs", jobId); // still alive — do not reclaim this job
      let analysis = getSegmentAnalysis(db, hash);

      if (isSegmentComplete(analysis)) {
        // Cache hit — zero API calls. `seg` is the target segment the donor
        // findings' timestamps get remapped onto (E-16 defect 1).
        reuseCachedFindings(db, job.sessionId, hash, seg);
        patchJob(db, jobId, { progress: (i + 1) / segments.length });
        continue;
      }

      // Stage 1 — triage the time-compressed rendition with the mini.
      if (analysis === null) {
        const miniCost = callCost(MINI_MODEL, seg.durationMs / tempo);
        if (wouldExceedBudget(db, miniCost, budget)) throw new BudgetHalt();
        const rendition = await fileBase64(renditionCachePath(hash, tempo));
        const miniSpend: SpendEntry = { model: MINI_MODEL, contentHash: hash, costUsd: miniCost };
        const triage = await billedCall(db, miniSpend, () =>
          client.triage({ audioBase64: rendition, format: "wav", targetLanguage }),
        );
        // Record the mini spend and its completion witness atomically, so a halt
        // (or crash) after the call can never re-bill this triage on resume.
        persistSegmentFindings(db, {
          sessionId: job.sessionId,
          contentHash: hash,
          flagged: triage.flagged,
          deepDone: false,
          findings: [],
          spend: miniSpend,
        });
        analysis = { contentHash: hash, flagged: triage.flagged, deepDone: false };
      }

      // Stage 2 — deep-listen the native-speed original, only if flagged.
      if (analysis.flagged && !analysis.deepDone) {
        const original = await fileBase64(segmentPath(job.sessionId, seg.idx));
        const { findings, spend } = await runDeep(
          db,
          client,
          seg,
          { audioBase64: original, format: "wav", targetLanguage },
          budget,
        );
        // Deep spend + findings + witness commit together (E-4 criterion 5).
        persistSegmentFindings(db, {
          sessionId: job.sessionId,
          contentHash: hash,
          flagged: true,
          deepDone: true,
          findings,
          spend,
        });
      }

      patchJob(db, jobId, { progress: (i + 1) / segments.length });
    }

    patchJob(db, jobId, { state: "done", stage: "done", progress: 1, error: null });
  } catch (err) {
    if (err instanceof BudgetHalt) {
      patchJob(db, jobId, { state: "halted", error: "Monthly budget reached." });
    } else {
      patchJob(db, jobId, { state: "failed", error: (err as Error).message || "Analysis failed." });
    }
  }
  return getAnalysisJob(db, jobId)!;
}

/** The set of segments a run would still bill for (not yet fully analyzed). */
export function pendingSegments(db: Db, sessionId: string): Segment[] {
  return listSegments(db, sessionId).filter(
    (s) => !isSegmentComplete(getSegmentAnalysis(db, s.contentHash)),
  );
}
