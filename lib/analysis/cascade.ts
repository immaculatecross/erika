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
  type ProducedLemma,
  ModelParseError,
  ModelUnavailableError,
} from "./audio-model";
import { claimQueued, heartbeat, reclaimStale, workerId } from "../jobs/lease";
import { JOB_LEASE_STALE_MS } from "../jobs/lease-config";
import { runPool } from "../jobs/pool";
import {
  getSegmentAnalysis,
  isSegmentComplete,
  persistSegmentFindings,
  reuseCachedFindings,
  type NewFinding,
} from "./findings";
import { callCost, DEEP_MODELS, MINI_MODEL, deepFullMaxMinutes, type ModelId } from "./rates";
import { sweepStaleReservations, type SpendReservation } from "./budget";
import { BudgetHalt, withRepair } from "./reserved-call";
import { recordProducedLemmas } from "./produced-lemmas";
import { collectSpeakerProfile, resolveRecurrence, type SpeakerProfile } from "./profile";
import { coerceRegister, type Register } from "../register";

/**
 * Bounded per-segment concurrency (E-27). The pool runs at most this many model
 * calls in flight at once, turning a serial day-scale walk into a wall-clock-minutes
 * one. Default ~6, floored to ≥1; tunable via ANALYSIS_CONCURRENCY (D-13). At N=6
 * a 12 h dump — VAD leaves ~1–2 h of speech, ~50% flagged (D-20), so a few hundred
 * ~10-min deep-listens of a few seconds each — completes in ~10–20 min instead of
 * hours, the constant-wall-clock property E-28's richness dial needs.
 */
export function analysisConcurrency(raw: string | undefined = process.env.ANALYSIS_CONCURRENCY): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isFinite(n)) return 6;
  return Math.max(1, Math.floor(n));
}

/**
 * How often the job's lease is refreshed while the pool runs (E-27 criterion 4).
 * Well under JOB_LEASE_STALE_MS (a fifth of it), so a long parallel batch beats
 * many times inside the stale window and is never mistaken for a crashed worker and
 * reclaimed mid-flight (the E-16 defect-2 double-billing guard). A single heartbeat
 * at the *start* of each segment (the old serial code) was fine when one segment ran
 * at a time; a pool must beat on a wall-clock interval instead.
 */
export const HEARTBEAT_INTERVAL_MS = Math.max(1000, Math.floor(JOB_LEASE_STALE_MS / 5));

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
    recurrenceOf: f.recurrenceOf ?? null,
    notes: f.notes ?? null,
  };
}

async function runDeep(
  db: Db,
  client: AudioModelClient,
  seg: Segment,
  input: DeepInput,
  budget: number,
): Promise<{ findings: NewFinding[]; produced: ProducedLemma[]; reservation: SpendReservation }> {
  let lastErr: Error | undefined;
  for (const model of DEEP_MODELS as readonly ModelId[]) {
    const cost = callCost(model, seg.durationMs);
    try {
      // The reservation (committed + pending ≤ cap, atomically) IS the pre-call
      // budget guard now — a refused reservation is a BudgetHalt inside withRepair.
      const { result: res, reservation } = await withRepair(db, model, seg.contentHash, cost, budget, (opts) =>
        client.deepListen(model, input, opts),
      );
      // The reservation is left PENDING and finalized atomically with the findings
      // and witness by the caller, so a crash between the two can never re-bill.
      // A recurrenceId citing a real profile entry is resolved to that entry's
      // correction and persisted with the finding; anything else resolves to null
      // and the finding persists exactly as before (E-19, D-13). `produced` is the
      // correctly-produced lemma list (E-28), recorded as evidence after the witness.
      return {
        findings: res.findings.map((f) =>
          toTimeline(seg, { ...f, recurrenceOf: resolveRecurrence(input.profile, f.recurrenceId) }),
        ),
        produced: res.produced ?? [],
        reservation,
      };
    } catch (err) {
      if (err instanceof ModelUnavailableError) {
        lastErr = err; // try the D-3 fallback model before giving up (its reservation was released)
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new ModelUnavailableError("No deep-listen model available.");
}

/**
 * Deep-listen one segment's native-speed original, persist its findings + spend +
 * completion witness atomically (E-4 c5), then record the correctly-produced lemmas
 * as positive production evidence (E-28). The witness commits complete BEFORE the
 * evidence write, so the segment is within the E-17 included scope when its
 * production is recorded; the evidence write is best-effort and never fails the run.
 * Used by both paths — the cascade's flagged branch and the short-capture full-deep
 * branch — so the deep persistence is identical however the segment reached it.
 */
async function deepListenSegment(
  db: Db,
  client: AudioModelClient,
  ctx: RunContext,
  seg: Segment,
): Promise<void> {
  const original = await fileBase64(segmentPath(ctx.sessionId, seg.idx));
  const { findings, produced, reservation } = await runDeep(
    db,
    client,
    seg,
    { audioBase64: original, format: "wav", targetLanguage: ctx.targetLanguage, profile: ctx.profile, register: ctx.register },
    ctx.budget,
  );
  persistSegmentFindings(db, {
    sessionId: ctx.sessionId,
    contentHash: seg.contentHash,
    flagged: true,
    deepDone: true,
    findings,
    reservation,
  });
  // Gate POSITIVE production credit (E-36, D-22). Findings/corrections above are
  // untouched — a correction may still be surfaced from a mixed segment — but a
  // produced-lemma positive is minted ONLY for the user's own speech: suppress it
  // when this segment was attributed to a non-user speaker (`is_user === 0`), or when
  // the whole session is manually excluded ("not me"). A null verdict (no enrollment,
  // filter off, or a hiccup) is NOT suppressed — behaviour is identical to before
  // attribution existed. The suppressed emits are still counted as dropped (honest yield).
  const suppress = ctx.excludeFromEvidence || seg.isUser === 0;
  recordProducedLemmas(db, ctx.sessionId, seg.contentHash, produced, { suppress });
}

/**
 * Record that this segment's audio could not be read, and let the run carry on.
 *
 * Before this, the ModelParseError escaped the segment loop and landed the whole
 * job `failed`, throwing away every other segment's (already paid for) analysis.
 * The witness keeps whatever the cascade did establish — an unreadable deep-listen
 * still knows the mini flagged the segment — so a later run resumes at the failed
 * call rather than re-billing the triage.
 */
function markUnreadable(
  db: Db,
  sessionId: string,
  hash: string,
  flagged: boolean,
  err: ModelParseError,
): void {
  persistSegmentFindings(db, {
    sessionId,
    contentHash: hash,
    flagged,
    deepDone: false,
    findings: [],
    unreadable: { reason: err.message, shape: err.shape ?? null },
  });
}

export interface RunOpts {
  /** Override the triage tempo (else from TRIAGE_TEMPO); must match E-3's. */
  tempo?: number;
  /** Max model calls in flight at once (else ANALYSIS_CONCURRENCY, ~6). */
  concurrency?: number;
  /** Lease heartbeat interval in ms (else HEARTBEAT_INTERVAL_MS). Tests set it small. */
  heartbeatMs?: number;
  /** Short-capture threshold in minutes (else DEEP_FULL_MAX_MINUTES, 30). Tests set it. */
  deepFullMaxMinutes?: number;
}

/**
 * Is this session a SHORT capture — total speech ≤ the threshold — so it takes the
 * full-deep path (no triage, 100% deep-listen)? Decided from ALL of the session's
 * segments (not just the pending ones), so the choice is stable regardless of what
 * is already cached, and identical for the run and the pre-run estimate (D-20).
 */
export function isFullDeepSession(segments: Segment[], maxMinutes: number = deepFullMaxMinutes()): boolean {
  const totalMs = segments.reduce((sum, s) => sum + s.durationMs, 0);
  return totalMs <= maxMinutes * 60_000;
}

/** The read-only per-run context threaded to each concurrent segment worker. */
interface RunContext {
  jobId: string;
  sessionId: string;
  targetLanguage: string;
  budget: number;
  profile: SpeakerProfile;
  /** The register the correction voice is phrased in (E-33, D-23). */
  register: Register;
  /** The manual session-level "not me" exclusion (E-36, D-22): when true, NO
   *  produced-lemma positive is minted for any segment of this run, regardless of the
   *  acoustic verdict. Read once per run from the session row. */
  excludeFromEvidence: boolean;
  tempo: number;
  /** The short-capture full-deep path (E-28, D-20): skip triage, deep-listen every
   *  segment at native speed with the enriched prompt. Decided once per run. */
  fullDeep: boolean;
}

/**
 * Process ONE segment. Two paths (D-20): the SHORT-capture full-deep path deep-
 * listens every segment with NO triage; the cascade triages, then deep-listens only
 * a flagged one. This is the body the pool runs concurrently. A cache hit makes zero
 * calls in both. A single unreadable reply is isolated here (`markUnreadable`) so one
 * bad segment never fails the run (E-16 criterion 4); every other failure — a refused
 * reservation (BudgetHalt), network, auth — throws out to halt or fail the whole run.
 * Each real call reserves before it fires and is finalized (or released) by outcome,
 * so the cap stays hard with the whole pool racing (E-27 criterion 2).
 */
async function processSegment(db: Db, client: AudioModelClient, ctx: RunContext, seg: Segment): Promise<void> {
  const hash = seg.contentHash;
  let analysis = getSegmentAnalysis(db, hash);

  // An unreadable TRIAGE established nothing about this audio, so a new run starts
  // it over. An unreadable DEEP kept its verdict and is resumed below at the deep
  // call, without re-billing. In full-deep there is no triage, so any deep_done=0
  // witness (unreadable or absent) simply re-runs the deep call.
  if (analysis?.unreadable && !analysis.flagged) analysis = null;

  if (isSegmentComplete(analysis)) {
    // Cache hit — zero API calls. `seg` is the target segment the donor findings'
    // timestamps get remapped onto (E-16 defect 1). A segment already fully analysed
    // (in either path) is never re-billed, so the short/long choice never re-charges
    // cached audio.
    reuseCachedFindings(db, ctx.sessionId, hash, seg);
    return;
  }

  try {
    if (ctx.fullDeep) {
      // Short-capture full-deep (D-20): no triage — deep-listen every segment at
      // native speed. `deepListenSegment` writes the witness (flagged=1, deep_done=1)
      // and the produced-lemma evidence.
      if (!analysis?.deepDone) await deepListenSegment(db, client, ctx, seg);
      return;
    }

    // Stage 1 — triage the time-compressed rendition with the mini.
    if (analysis === null) {
      const miniCost = callCost(MINI_MODEL, seg.durationMs / ctx.tempo);
      const rendition = await fileBase64(renditionCachePath(hash, ctx.tempo));
      const { result: triage, reservation } = await withRepair(db, MINI_MODEL, hash, miniCost, ctx.budget, (opts) =>
        client.triage({ audioBase64: rendition, format: "wav", targetLanguage: ctx.targetLanguage, profile: ctx.profile }, opts),
      );
      // Finalize the mini reservation with its completion witness atomically, so a
      // halt (or crash) after the call can never re-bill this triage on resume.
      persistSegmentFindings(db, {
        sessionId: ctx.sessionId,
        contentHash: hash,
        flagged: triage.flagged,
        deepDone: false,
        findings: [],
        reservation,
      });
      analysis = getSegmentAnalysis(db, hash)!;
    }

    // Stage 2 — deep-listen the native-speed original, only if flagged.
    if (analysis.flagged && !analysis.deepDone) await deepListenSegment(db, client, ctx, seg);
  } catch (err) {
    // One unreadable reply is a fact about ONE segment, not about the run: the job
    // records it, reports it, and keeps going (E-16b criterion 4). Every other kind
    // of failure — budget, network, auth — still stops the run. In full-deep a
    // segment is treated as flagged (it was deep-listened), so an unreadable deep
    // resumes at the deep call on a later run.
    if (!(err instanceof ModelParseError)) throw err;
    markUnreadable(db, ctx.sessionId, hash, analysis?.flagged ?? ctx.fullDeep, err);
  }
}

/**
 * Run (or resume) one analysis job. Advances queued → processing → done; on a
 * budget breach lands `halted` (findings so far kept, cap never exceeded); on any
 * other failure lands `failed` with a truthful message. Cached segments make zero
 * model calls and record nothing. Does not throw on run failure — it is recorded.
 *
 * Segments run through a bounded concurrency pool (E-27) so a day-scale dump lands
 * in wall-clock minutes; the cap stays hard because every call reserves before it
 * fires (committed + pending ≤ budget, atomically). The lease is refreshed on an
 * interval for the whole run so a long parallel batch is never reclaimed mid-flight.
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

  // Release reservations a crashed run abandoned between reserve and finalize, so
  // they stop counting against the cap for this run (E-27 criterion 3). Only rows
  // older than the TTL are swept — never a live in-flight reservation.
  sweepStaleReservations(db);

  const settings = readSettings(db);
  const { targetLanguage, monthlyBudgetUsd: budget } = settings;
  const register = coerceRegister(settings.register);
  // The speaker profile (E-19), built ONCE per run from data already on disk —
  // no model call, read-only. It rides along in the prompt inputs only; it is
  // deliberately NOT part of the segment cache identity (content_hash), so a
  // profile that has grown since last month can never re-bill cached audio.
  const profile: SpeakerProfile = collectSpeakerProfile(db);
  const tempo = opts.tempo ?? triageTempo();
  const segments = listSegments(db, job.sessionId);
  // Short-capture full-deep decision (D-20), made ONCE per run from the session's
  // total speech so every segment takes the same path — and so it matches what the
  // pre-run estimate showed the user (the estimate uses the same `isFullDeepSession`).
  const fullDeep = isFullDeepSession(segments, opts.deepFullMaxMinutes);
  const ctx: RunContext = {
    jobId,
    sessionId: job.sessionId,
    targetLanguage,
    budget,
    profile,
    register,
    excludeFromEvidence: session.excludeFromEvidence,
    tempo,
    fullDeep,
  };
  patchJob(db, jobId, { state: "processing", stage: fullDeep ? "deep-listening" : "analyzing", error: null });

  // Refresh the lease on an interval for the whole run, not once per segment: a long
  // parallel batch beats many times inside the stale window so it is never reclaimed
  // mid-flight (E-16 defect 2 / E-27 criterion 4). Cleared in `finally`.
  const beat = () => heartbeat(db, "analysis_jobs", jobId);
  beat();
  const timer = setInterval(beat, opts.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();

  // Progress counts COMPLETIONS (E-27 criterion 6): a shared counter incremented as
  // each segment settles, monotonic under concurrency (JS is single-threaded, so ++
  // never interleaves).
  let completed = 0;
  const total = segments.length;

  try {
    await runPool(segments, opts.concurrency ?? analysisConcurrency(), async (seg) => {
      await processSegment(db, client, ctx, seg);
      completed += 1;
      patchJob(db, jobId, { progress: total === 0 ? 1 : completed / total });
    });
    patchJob(db, jobId, { state: "done", stage: "done", progress: 1, error: null });
  } catch (err) {
    if (err instanceof BudgetHalt) {
      patchJob(db, jobId, { state: "halted", error: "Monthly budget reached." });
    } else {
      patchJob(db, jobId, { state: "failed", error: (err as Error).message || "Analysis failed." });
    }
  } finally {
    clearInterval(timer);
  }
  return getAnalysisJob(db, jobId)!;
}

/** The set of segments a run would still bill for (not yet fully analyzed). */
export function pendingSegments(db: Db, sessionId: string): Segment[] {
  return listSegments(db, sessionId).filter(
    (s) => !isSegmentComplete(getSegmentAnalysis(db, s.contentHash)),
  );
}
