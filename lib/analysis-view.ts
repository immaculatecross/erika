// Client-safe view model for the analysis report UI (E-4 part 2). Like
// lib/ingest-view.ts, no Node imports live here so the detail page, the polling
// hook, and the read route all share one shape and one set of pure, unit-testable
// helpers. The server route fills this from lib/analysis/* (the job + findings)
// and the page renders it — nothing here touches better-sqlite3 or the filesystem.

import type { Category, Severity } from "./analysis/findings";
import type { AnalysisState } from "./analysis/cascade";

export type { Category, Severity } from "./analysis/findings";

/**
 * UI state: the run's state, or "idle" when the session has never been analyzed
 * (no job yet) — the moment the Analyze call-to-action is shown.
 */
export type AnalysisViewState = AnalysisState | "idle";

/** The five categories in the order the report renders their counts. */
export const CATEGORY_ORDER = [
  "grammar",
  "vocabulary",
  "phrasing",
  "idiom",
  "pronunciation",
] as const satisfies readonly Category[];

/** One finding reduced to what the report renders (no session/hash plumbing). */
export interface FindingView {
  id: string;
  quote: string;
  correction: string;
  category: Category;
  explanation: string;
  severity: Severity;
  startMs: number;
  endMs: number;
}

/** A category paired with how many findings fall under it (may be zero). */
export interface CategoryCount {
  category: Category;
  count: number;
}

/** The whole payload the analysis read route returns and the panel renders. */
export interface AnalysisView {
  state: AnalysisViewState;
  stage: string | null;
  progress: number;
  error: string | null;
  findings: FindingView[];
  /** All five categories, in display order, with their counts (0 included). */
  counts: CategoryCount[];
  /** Total findings across every category. */
  total: number;
  /**
   * Speech segments this session has. Zero means ingest has not produced anything
   * to analyze — the state that used to offer Analyze, estimate $0, run, and then
   * report "no findings", which reads as a clean bill of health (E-16b criterion 5).
   */
  segmentCount: number;
  /** Segments whose model reply could not be read (E-16b criterion 4). */
  unreadableCount: number;
  /** No worker is draining this run's queue (E-16b criterion 2). */
  workerAbsent: boolean;
}

/**
 * The honest one-line tally under a finished run, or null when there is nothing
 * to qualify. A run that lost a segment must say so — "no findings" over 14 of 15
 * segments is a different claim from "no findings" over all 15.
 */
export function segmentTally(segmentCount: number, unreadableCount: number): string | null {
  if (unreadableCount <= 0) return null;
  const analysed = Math.max(0, segmentCount - unreadableCount);
  return `${analysed} of ${segmentCount} segments analysed · ${unreadableCount} unreadable`;
}

/** Human labels for each analysis stage the orb shows while a run is in flight. */
export const ANALYSIS_STAGE_LABELS: Record<string, string> = {
  analyzing: "Listening for errors",
  done: "Done",
};

/**
 * Pure per-category tally over the five categories, always returning all five in
 * CATEGORY_ORDER (a category with no findings reports 0) so the report renders a
 * stable row of counts rather than only the categories that happened to appear.
 */
export function categoryCounts(findings: readonly { category: Category }[]): CategoryCount[] {
  const tally = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const f of findings) tally.set(f.category, (tally.get(f.category) ?? 0) + 1);
  return CATEGORY_ORDER.map((category) => ({ category, count: tally.get(category) ?? 0 }));
}
