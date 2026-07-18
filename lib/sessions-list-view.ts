// Client-safe view model for the sessions list (E-18). Like lib/analysis-view.ts,
// no Node imports live here so the list page, the inline-analyze affordance and
// the read route share one shape and one pure, unit-testable gate. The server
// fills `SessionListItem` in lib/session-yield.ts; nothing here touches
// better-sqlite3.

import type { Category } from "./analysis/findings";
import type { Session } from "./session-types";

/** What an analysed session yielded — the row's honest summary (criterion 2). */
export interface SessionYield {
  /** Σ duration of the segments a model actually heard, in ms (E-17 scope). */
  analysedSpeechMs: number;
  findingsCount: number;
  /** The category with the most findings (ties by CATEGORY_ORDER); null when 0. */
  dominantCategory: Category | null;
}

/** One sessions-list row: the session plus what the home screen tells about it. */
export interface SessionListItem extends Session {
  /** Speech segments ingest extracted (0 until ingest completes, or on silence). */
  segmentCount: number;
  /** Analysed per the canonical read-model (lib/findings-model.ts) — never a job state. */
  analysed: boolean;
  /** An analysis run of this session's own is queued or processing right now. */
  analysisPending: boolean;
  /** Present exactly when `analysed` — what the analysis yielded. */
  sessionYield: SessionYield | null;
}

/**
 * What the row may offer for analysis. Mirrors the server's own gates exactly —
 * POST /api/sessions/[id]/analysis 409s on a session with no segments, and an
 * unextracted or failed ingest has nothing to analyze — so the list never shows
 * an affordance the server would refuse (criterion 3, no false affordance).
 */
export type AnalyzeGate =
  | "analysed" // evidence exists; the row reports yield, not an affordance
  | "running" // a run is queued/processing — say so, never offer a second press
  | "analyze" // ingested, has speech, never analysed: the honest affordance
  | "ingest-pending" // ingest still queued/processing — nothing to analyze yet
  | "ingest-failed" // ingest failed — analysis is impossible, say why
  | "no-segments"; // ingest done but no speech found — a $0 run would lie

export function analyzeGate(item: SessionListItem): AnalyzeGate {
  if (item.analysed) return "analysed";
  if (item.analysisPending) return "running";
  if (item.jobState === "failed") return "ingest-failed";
  if (item.jobState !== "done") return "ingest-pending";
  if (item.segmentCount === 0) return "no-segments";
  return "analyze";
}
