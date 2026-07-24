// Client-safe view model for the analysis report UI (E-4 part 2). Like
// lib/ingest-view.ts, no Node imports live here so the detail page, the polling
// hook, and the read route all share one shape and one set of pure, unit-testable
// helpers. The server route fills this from lib/analysis/* (the job + findings)
// and the page renders it — nothing here touches better-sqlite3 or the filesystem.

import type { Category, FindingNotes, Severity } from "./analysis/findings";
import type { AnalysisState } from "./analysis/cascade";

export type { Category, FindingNotes, Severity } from "./analysis/findings";

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
  /**
   * The enriched observation channel the richness dial paid for (E-28, v16),
   * surfaced as the report's "Erika also noticed" line (E-30 P2). Null/absent when
   * the deep model returned no enrichment for this finding — most findings. The
   * three fields (pronunciation suspect, colto register upgrade, disfluency) are
   * annotations ON the finding, subordinate to its correction.
   */
  notes?: FindingNotes | null;
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
  /**
   * Segments a model actually heard — counted from the analysis witnesses by the
   * canonical read-model, never inferred by subtraction (E-17 criterion 1/5).
   */
  analysedCount: number;
  /** Segments whose model reply could not be read (E-16b criterion 4). */
  unreadableCount: number;
  /** No worker is draining this run's queue (E-16b criterion 2). */
  workerAbsent: boolean;
}

/**
 * The honest one-line tally under a run, or null when the run covered everything
 * and lost nothing. "No findings" over 14 of 15 segments is a different claim from
 * "no findings" over all 15 — and so is "no findings" over the 2 of 6 a budget
 * halt reached.
 *
 * `analysedCount` is counted, not derived. It used to be `segmentCount −
 * unreadableCount`, which is exact on a run that finished but credits every
 * segment a halted run never touched: 6 segments with 1 analysed, 1 unreadable and
 * 4 never reached reported "5 of 6 segments analysed · 1 unreadable" (E-16 review,
 * advisory 2). The count now comes from the analysis witnesses via
 * `sessionSegmentCounts`, so it is true in every run state.
 */
export function segmentTally(
  segmentCount: number,
  analysedCount: number,
  unreadableCount: number,
): string | null {
  if (segmentCount <= 0) return null;
  const analysed = Math.min(Math.max(0, analysedCount), segmentCount);
  if (analysed >= segmentCount && unreadableCount <= 0) return null;
  const line = `${analysed} of ${segmentCount} segments analysed`;
  return unreadableCount > 0 ? `${line} · ${unreadableCount} unreadable` : line;
}

/**
 * Severity badge styling, shared by every surface that shows a finding (the
 * report, the letter, the Phrasebook, the Archive) so they can never disagree.
 * Green is reserved for resolved/mastered/improving (DESIGN.md, D-14, E-18
 * criterion 6): a LOW-severity mistake is still a mistake, so it reads neutral —
 * only red and orange remain on severities, and only because they carry meaning.
 */
export const SEVERITY_STYLES: Record<
  Severity,
  { label: string; dot: string; text: string; tint: string }
> = {
  high: { label: "High", dot: "bg-severe", text: "text-severe", tint: "bg-severe/[0.12]" },
  medium: { label: "Medium", dot: "bg-medium", text: "text-medium", tint: "bg-medium/[0.12]" },
  low: {
    label: "Low",
    dot: "bg-secondary",
    text: "text-secondary",
    tint: "bg-black/[0.06] dark:bg-white/[0.08]",
  },
};

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
