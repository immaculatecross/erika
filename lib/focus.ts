import type { Db } from "./db";
import type { Category, Severity } from "./analysis/findings";
import { findingTallies, listAnalysedSessions } from "./findings-model";
import { CATEGORY_ORDER } from "./analysis-view";
import { resolvedSlipCount } from "./slips";

// The Focus map aggregation (E-7, v0.2 milestone 1). Pure metric math over the
// data v0.1 already produced — no model calls, no writes, no new capture. The
// question this answers on one screen: how often do I make each kind of mistake,
// is it getting better, and what should I work on next?
//
// `computeFocus` is a pure function of typed rows so every metric is unit-testable
// against hand-computed fixtures; `collectAnalyzedSessions` is the only DB-touching
// part and uses the existing typed accessors (no raw SQL of its own).

export type { Category, Severity } from "./analysis/findings";
export { CATEGORY_ORDER } from "./analysis-view";

/** Severity → its "what to work on next" weight (D-15 pinned): high hurts most. */
export const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 2, low: 1 };

const MS_PER_HOUR = 3_600_000;
// Rates are exact rationals over fixtures; a tiny epsilon only absorbs float noise
// when deciding a trend's direction so a dead-equal rate reads "steady", not a flip.
const EPS = 1e-9;

/** improving = the rate FELL (fewer errors per hour later); worsening = it rose. */
export type TrendDirection = "improving" | "worsening" | "flat";

/** One analyzed session reduced to what the metrics need (the pure input row). */
export interface AnalyzedSession {
  id: string;
  createdAt: string;
  /** Σ of the session's kept-speech segment durations, in ms. */
  speechMs: number;
  findings: { category: Category; severity: Severity }[];
}

/** A category's standing: how often, how bad, and which way it's trending. */
export interface CategoryMetric {
  category: Category;
  count: number;
  /** findings ÷ total analyzed speech-hours. */
  ratePerHour: number;
  /** Σ(weight × count) ÷ speech-hours — the ranking key. */
  weightedRatePerHour: number;
  /** Earliest analyzed session's rate vs the most recent, for this category. */
  trend: TrendDirection;
}

/** One chronological bucket: a single analyzed session's overall error rate. */
export interface TrendPoint {
  sessionId: string;
  speechHours: number;
  findings: number;
  ratePerHour: number;
}

/** The whole payload the /api/focus route returns and the Focus screen renders. */
export interface FocusModel {
  analyzedSessions: number;
  speechHours: number;
  totalFindings: number;
  overallRatePerHour: number;
  overallTrend: TrendDirection;
  /** All five categories in CATEGORY_ORDER, zero-filled (never absent/NaN). */
  categories: CategoryMetric[];
  /** The same metrics sorted by weighted rate, highest first — work on next. */
  ranking: CategoryMetric[];
  /** Buckets in chronological order (oldest first) — the trend sparkline. */
  trend: TrendPoint[];
}

function direction(earlier: number, later: number): TrendDirection {
  if (later < earlier - EPS) return "improving"; // rate fell
  if (later > earlier + EPS) return "worsening"; // rate rose
  return "flat";
}

/** Chronological, deterministic order: by createdAt, ties broken by id. */
function chronological(sessions: readonly AnalyzedSession[]): AnalyzedSession[] {
  return [...sessions].sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** This category's rate within one session (its count ÷ that session's hours). */
function categoryRate(s: AnalyzedSession, category: Category): number {
  const hours = s.speechMs / MS_PER_HOUR;
  if (hours <= EPS) return 0;
  return s.findings.filter((f) => f.category === category).length / hours;
}

/**
 * Compute every Focus metric from the analyzed sessions. Speech-hours is the sole
 * denominator (Σ segment ms over analyzed sessions ÷ 3.6M); a category with no
 * findings reads 0, never NaN, even when there is no speech at all.
 */
export function computeFocus(sessions: readonly AnalyzedSession[]): FocusModel {
  const ordered = chronological(sessions);
  const speechHours = ordered.reduce((sum, s) => sum + s.speechMs, 0) / MS_PER_HOUR;
  const perHour = (n: number) => (speechHours > EPS ? n / speechHours : 0);

  const count = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  const weight = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  let totalFindings = 0;
  for (const s of ordered) {
    for (const f of s.findings) {
      count.set(f.category, (count.get(f.category) ?? 0) + 1);
      weight.set(f.category, (weight.get(f.category) ?? 0) + SEVERITY_WEIGHT[f.severity]);
      totalFindings++;
    }
  }

  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const categoryTrend = (c: Category): TrendDirection =>
    ordered.length < 2 ? "flat" : direction(categoryRate(first, c), categoryRate(last, c));

  const categories: CategoryMetric[] = CATEGORY_ORDER.map((category) => ({
    category,
    count: count.get(category) ?? 0,
    ratePerHour: perHour(count.get(category) ?? 0),
    weightedRatePerHour: perHour(weight.get(category) ?? 0),
    trend: categoryTrend(category),
  }));

  const ranking = [...categories].sort(
    (a, b) =>
      b.weightedRatePerHour - a.weightedRatePerHour ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
  );

  const trend: TrendPoint[] = ordered.map((s) => {
    const hours = s.speechMs / MS_PER_HOUR;
    const findings = s.findings.length;
    return { sessionId: s.id, speechHours: hours, findings, ratePerHour: hours > EPS ? findings / hours : 0 };
  });

  const overallTrend =
    trend.length < 2 ? "flat" : direction(trend[0].ratePerHour, trend[trend.length - 1].ratePerHour);

  return {
    analyzedSessions: ordered.length,
    speechHours,
    totalFindings,
    overallRatePerHour: perHour(totalFindings),
    overallTrend,
    categories,
    ranking,
    trend,
  };
}

/**
 * Read every *analysed* session into the pure input rows, via the canonical
 * read-model (lib/findings-model.ts): its analysed speech time and its findings.
 * The scope — what counts as analysed, and how a halted run or an in-flight
 * re-analysis is treated — is defined there, once, and shared with the letter,
 * the Phrasebook, the Archive, the lesson patterns and card generation (E-17).
 *
 * TWO queries for the whole database, both aggregating in SQL, rather than the
 * three-per-session loop this replaced (`listSegments` + `listFindings` +
 * `getAnalysisJobBySession` for every session on every GET). The tallies come back
 * pre-counted by SQL `GROUP BY`; expanding each count back into that many
 * `{category, severity}` entries keeps `computeFocus`'s hand-verified metric math
 * untouched and its results identical.
 */
export function collectAnalyzedSessions(db: Db): AnalyzedSession[] {
  const bySession = new Map<string, { category: Category; severity: Severity }[]>();
  for (const t of findingTallies(db)) {
    const bucket = bySession.get(t.sessionId) ?? [];
    for (let i = 0; i < t.count; i++) bucket.push({ category: t.category, severity: t.severity });
    bySession.set(t.sessionId, bucket);
  }
  return listAnalysedSessions(db).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    speechMs: s.analysedSpeechMs,
    findings: bySession.get(s.id) ?? [],
  }));
}

/** The Focus model for the whole database — what the read route serves. */
export function buildFocusModel(db: Db): FocusModel {
  return computeFocus(collectAnalyzedSessions(db));
}

/**
 * The Focus payload the read route serves: the metric model plus the count of
 * RESOLVED slips (E-20) — the one number Focus attaches green to. `FocusModel`
 * and `computeFocus` are deliberately untouched (their math is hand-verified and
 * the ranking is unchanged); the slip count is layered on top here, read-only.
 */
export interface FocusPayload extends FocusModel {
  /** Recurring mistakes now resolved — mastery, the only place green belongs. */
  resolvedSlips: number;
}

/** The Focus model for the whole database, plus the resolved-slip count (E-20). */
export function buildFocusPayload(db: Db): FocusPayload {
  return { ...buildFocusModel(db), resolvedSlips: resolvedSlipCount(db) };
}
