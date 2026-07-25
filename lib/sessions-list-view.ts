// Client-safe view model for the sessions list (E-18, rewritten for E-42). Like
// lib/analysis-view.ts, no Node imports live here so the list page, the row and the
// read route share one shape and one pure, unit-testable state machine. The server
// fills `SessionListItem` in lib/session-yield.ts; nothing here touches better-sqlite3.
//
// WHAT CHANGED AND WHY (D-26, criteria 1–2). This file used to export `analyzeGate`,
// whose whole job was deciding whether to offer the learner an **Analyze** button.
// There is no such button any more: analysis is enqueued server-side the moment
// ingest completes (lib/analysis/auto.ts), so the question the list answers is no
// longer "may I offer a run?" but "where is this recording up to?". The gate is
// replaced by `sessionPhase` — the same exhaustive, no-false-affordance discipline,
// aimed at a truthful *state* instead of a control.

import type { Category } from "./analysis/findings";
import type { Session } from "./session-types";

/** What an analysed session yielded — the row's honest summary. */
export interface SessionYield {
  findingsCount: number;
  /** The category with the most findings (ties by CATEGORY_ORDER); null when 0. */
  dominantCategory: Category | null;
  /** Every speech segment the session has. */
  segmentCount: number;
  /** How many of those a model actually heard (E-17 scope). Less than
   *  `segmentCount` after a halted or partial run — and the difference is what
   *  keeps "no mistakes found" from being a clean bill of health on unheard audio. */
  analysedSegmentCount: number;
}

/** The analysis run's state as the list sees it — `idle` means no run exists. */
export type ListAnalysisState = "idle" | "queued" | "processing" | "done" | "failed" | "halted";

/** One sessions-list row: the session plus what the home screen tells about it. */
export interface SessionListItem extends Session {
  /** Speech segments ingest extracted (0 until ingest completes, or on silence). */
  segmentCount: number;
  /** Analysed per the canonical read-model (lib/findings-model.ts) — never a job state. */
  analysed: boolean;
  /** Present exactly when `analysed` — what the analysis yielded. */
  sessionYield: SessionYield | null;
  /** The ingest job's fine-grained stage, for the in-flight line. */
  ingestStage: string | null;
  /** The ingest job's stored message when it failed. */
  ingestError: string | null;
  /** This session's latest analysis run, or `idle` when none exists yet. */
  analysisState: ListAnalysisState;
  /** 0..1 completion of that run — segments settled ÷ segments total. */
  analysisProgress: number;
  /** The run's stored message when it failed or halted. */
  analysisError: string | null;
  /**
   * Nothing is draining this session's queue — no `npm run worker` (E-16b). True
   * for whichever of its two jobs is currently the one waiting.
   */
  workerAbsent: boolean;
  /**
   * The analysis is stopped because no `OPENAI_API_KEY` is set — a PERMANENT
   * condition, not a hiccup, so it is modelled as its own phase rather than folded
   * into "failed" (criterion 9, RETRO-004's "unavailable right now" pattern).
   */
  analysisNeedsKey: boolean;
}

/**
 * Where a recording is up to. Exhaustive and ordered by the pipeline, so a row can
 * never show two truths or none. The three terminal-ish phases a learner must ACT on
 * (`needs-key`, `budget-reached`, `failed`) are deliberately separate: they have
 * different fixes, and collapsing them is how "unavailable right now" got written
 * thirteen times over a permanent condition.
 */
export type SessionPhase =
  | "ingest-queued" // uploaded; nothing has picked it up yet
  | "ingesting" // speech is being extracted
  | "ingest-failed" // the audio could not be processed
  | "no-speech" // ingest finished and found nothing to analyse
  | "analysis-queued" // speech is ready; the run is waiting for the worker
  | "analysing" // a model is listening right now
  | "needs-key" // stopped: no API key, and that will not change on its own
  | "budget-reached" // held: the monthly cap; resumes when there is headroom
  | "analysis-failed" // stopped: something else, with its own message
  | "analysed"; // findings exist

export function sessionPhase(item: SessionListItem): SessionPhase {
  // Evidence first: `analysed` comes from the canonical read-model, so a session
  // with findings reads as analysed even while a later re-run is in flight.
  if (item.analysed) return "analysed";
  if (item.jobState === "failed") return "ingest-failed";
  if (item.jobState !== "done") return item.jobState === "queued" ? "ingest-queued" : "ingesting";
  if (item.segmentCount === 0) return "no-speech";
  if (item.analysisNeedsKey) return "needs-key";
  if (item.analysisState === "halted") return "budget-reached";
  if (item.analysisState === "failed") return "analysis-failed";
  if (item.analysisState === "processing") return "analysing";
  // `idle` lands here too: the sweep queues it within a tick, and "waiting" is the
  // honest word for both. Claiming "analysing" would be a percentage we cannot compute.
  return "analysis-queued";
}

/** Is this phase one where work is still expected to happen by itself? */
export function isInFlight(phase: SessionPhase): boolean {
  return (
    phase === "ingest-queued" ||
    phase === "ingesting" ||
    phase === "analysis-queued" ||
    phase === "analysing" ||
    phase === "budget-reached" // the worker resumes it when there is headroom
  );
}

/** Human labels for the ingest stages (mirrors lib/ingest/pipeline.ts STAGES). */
const INGEST_STAGE_LINE: Record<string, string> = {
  normalizing: "Preparing the audio",
  detecting: "Finding the speech",
  segmenting: "Finding the speech",
  attributing: "Checking whose voice it is",
  rendering: "Almost ready",
};

/**
 * The one quiet sentence a row shows for its phase — DESIGN copy: factual, specific,
 * never a cheer and never a percentage the code cannot honestly compute.
 *
 * Where a number IS honest it is used: the analysis run counts COMPLETED segments
 * against the total, which is a real ratio of real work. Ingest progress is a
 * stage checkpoint, not a measurement, so it is spoken as a stage and never as a
 * percentage — saying "40%" of an unmeasured thing is the lie this rule exists for.
 */
export function progressLine(item: SessionListItem): string {
  switch (sessionPhase(item)) {
    case "analysed":
      return yieldLine(item);
    case "ingest-queued":
      return item.workerAbsent ? "Waiting — the worker isn’t running" : "Waiting to start";
    case "ingesting":
      return (item.ingestStage && INGEST_STAGE_LINE[item.ingestStage]) || "Finding the speech";
    case "ingest-failed":
      return item.ingestError ?? "This recording couldn’t be processed";
    case "no-speech":
      return "No speech found in this recording";
    case "analysis-queued":
      return item.workerAbsent ? "Waiting — the worker isn’t running" : "Waiting to be listened to";
    case "analysing":
      return "Listening";
    case "needs-key":
      return "Waiting for an API key";
    case "budget-reached":
      return "Paused — this month’s budget is spent";
    case "analysis-failed":
      return item.analysisError ?? "The analysis stopped";
  }
}

/** The second line: what the learner can do, when there is something to do. */
export interface PhaseAction {
  label: string;
  href: string;
}

export function phaseAction(item: SessionListItem): PhaseAction | null {
  switch (sessionPhase(item)) {
    case "needs-key":
      // Settings is where the key requirement is explained (criterion 7). The link
      // is the difference between a wall and a way forward — RETRO-004 §1 found this
      // exact copy pointing nowhere.
      return { label: "How to add one", href: "/settings" };
    case "budget-reached":
      return { label: "Raise the budget", href: "/settings" };
    default:
      return null;
  }
}

/**
 * The yield line an analysed row states — what Erika heard, and how much of it.
 *
 * The partial qualifier is not decoration (E-16b criterion 4): "no mistakes found"
 * over 1 of 15 segments is a completely different claim from the same words over
 * all 15, and without the count the difference is invisible — it reads as a clean
 * bill of health on audio no model ever heard. A run halted by the budget cap lands
 * in exactly that state, which is why this milestone, which makes runs automatic,
 * has to carry the qualifier onto the home screen too.
 */
export function yieldLine(item: SessionListItem): string {
  const y = item.sessionYield;
  if (!y) return "Analysed";
  const findings =
    y.findingsCount === 0
      ? "No mistakes found"
      : `${y.findingsCount} ${y.findingsCount === 1 ? "mistake" : "mistakes"}`;
  const head =
    y.dominantCategory && y.findingsCount > 0 ? `${findings} · mostly ${y.dominantCategory}` : findings;
  const partial = y.analysedSegmentCount < y.segmentCount;
  return partial ? `${head} · heard ${y.analysedSegmentCount} of ${y.segmentCount}` : head;
}
