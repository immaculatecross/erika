import type { Db } from "./db";
import type { Category, Severity } from "./analysis/findings";
import { listAnalysedSessions, listIncludedFindings } from "./findings-model";
import { computeFocus, SEVERITY_WEIGHT, CATEGORY_ORDER, type AnalyzedSession, type TrendDirection } from "./focus";

// The editor's letter (E-12, v0.2 milestone 5 — the finale). A quiet weekly digest,
// the narrative counterpart to the Focus map: your trend this week, a few of your
// best recasts, and the one thing to work on next. Model-light — deterministic
// aggregation over the findings v0.1/v0.2 already produced. No model calls, no
// writes, no gamification; Erika speaks "like a good editor" (DESIGN.md copy).
//
// `computeLetter` is a pure function of typed session rows so every rule — the ISO
// week bounds, the trend vs the prior week, the deterministic best-recasts pick,
// the focus-next category — is unit-testable against hand-computed fixtures. The
// per-week rate and the "one thing" ranking REUSE `computeFocus` rather than
// reimplementing the severity-weighted math. `collectLetterSessions` is the only
// DB-touching part and uses the existing typed accessors (no raw SQL of its own).

export type { Category, Severity } from "./analysis/findings";
export type { TrendDirection } from "./focus";

// Rates are exact rationals; a tiny epsilon absorbs float noise when reading a
// trend's direction so a dead-equal week reads "steady", not a spurious flip.
const EPS = 1e-9;
const DAY_MS = 86_400_000;

/** One finding carried whole into the letter — both sides and the why, for recasts. */
export interface LetterFinding {
  id: string;
  quote: string;
  correction: string;
  explanation: string;
  category: Category;
  severity: Severity;
}

/** One analyzed session reduced to what the letter needs (the pure input row). */
export interface LetterSession {
  id: string;
  /** The session's `createdAt` (SQLite UTC) — which ISO week it falls in. */
  createdAt: string;
  /** Σ of the session's kept-speech segment durations, in ms. */
  speechMs: number;
  findings: LetterFinding[];
}

/** This week's rate against the prior week's — the letter's one trend. */
export interface LetterTrend {
  direction: TrendDirection;
  /** False when the prior calendar week had no analyzed speech — no fake trend. */
  hasPrior: boolean;
  /** This week's error rate (findings ÷ speech-hours). */
  current: number;
  /** The prior week's rate, or null when there is no prior week. */
  prior: number | null;
}

/** The one category to work on next — the top severity-weighted rate this week. */
export interface LetterFocus {
  category: Category;
  count: number;
  ratePerHour: number;
  weightedRatePerHour: number;
}

/** The whole payload the /api/letter route returns and the letter screen renders. */
export interface Letter {
  /** Monday 00:00 UTC of the letter's ISO week, as "YYYY-MM-DD". */
  weekStart: string;
  /** Sunday of the same ISO week, as "YYYY-MM-DD" — the inclusive display end. */
  weekEnd: string;
  analyzedSessions: number;
  speechHours: number;
  totalFindings: number;
  ratePerHour: number;
  trend: LetterTrend;
  /** Up to three notable recasts from the week (see `selectRecasts`). */
  recasts: LetterFinding[];
  /** The one thing to work on next week, or null on a week with no findings. */
  focusNext: LetterFocus | null;
}

function parseUtc(createdAt: string): Date {
  return new Date(`${createdAt.replace(" ", "T")}Z`);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * The Monday 00:00 UTC that opens the ISO-8601 week containing `createdAt`,
 * as "YYYY-MM-DD". ISO weeks run Monday→Sunday; JS `getUTCDay` is 0=Sunday, so
 * `(day + 6) % 7` is the number of days since Monday.
 */
export function isoWeekStart(createdAt: string): string {
  const d = parseUtc(createdAt);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - sinceMonday * DAY_MS);
  return ymd(monday);
}

/** The Sunday (inclusive) that closes the ISO week opened by `weekStart`. */
function isoWeekEnd(weekStart: string): string {
  return ymd(new Date(parseUtc(`${weekStart} 00:00:00`).getTime() + 6 * DAY_MS));
}

/** The Monday that opens the week immediately before `weekStart`. */
function priorWeekStart(weekStart: string): string {
  return ymd(new Date(parseUtc(`${weekStart} 00:00:00`).getTime() - 7 * DAY_MS));
}

/** improving = the rate FELL (fewer errors per hour than last week); rose = worsening. */
function direction(prior: number, current: number): TrendDirection {
  if (current < prior - EPS) return "improving";
  if (current > prior + EPS) return "worsening";
  return "flat";
}

const toAnalyzed = (s: LetterSession): AnalyzedSession => ({
  id: s.id,
  createdAt: s.createdAt,
  speechMs: s.speechMs,
  findings: s.findings.map((f) => ({ category: f.category, severity: f.severity })),
});

/**
 * The deterministic best-recasts rule: from the week's findings, sort by severity
 * (high → low), then category order, then id — so the pick is stable and the most
 * costly slip leads. De-duplicate identical quote→correction pairs (keeping the
 * highest-severity representative). Then take up to three, **preferring a category
 * not yet chosen** (one grammar, one idiom, … rather than three of a kind); if
 * fewer than three distinct categories exist, fill the remaining slots from the
 * same sorted order. Pure — no DB, no model.
 */
export function selectRecasts(findings: readonly LetterFinding[], limit = 3): LetterFinding[] {
  const priority = (f: LetterFinding) => SEVERITY_WEIGHT[f.severity];
  const sorted = [...findings].sort(
    (a, b) =>
      priority(b) - priority(a) ||
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const seen = new Set<string>();
  const deduped = sorted.filter((f) => {
    const key = `${f.quote.trim().toLowerCase()}\0${f.correction.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const picked: LetterFinding[] = [];
  const usedCats = new Set<Category>();
  for (const f of deduped) {
    if (picked.length >= limit) break;
    if (!usedCats.has(f.category)) {
      picked.push(f);
      usedCats.add(f.category);
    }
  }
  for (const f of deduped) {
    if (picked.length >= limit) break;
    if (!picked.includes(f)) picked.push(f);
  }
  return picked;
}

/** All findings of the sessions falling inside the ISO week opened by `weekStart`. */
function weekFindings(sessions: readonly LetterSession[], weekStart: string): LetterFinding[] {
  return sessions.filter((s) => isoWeekStart(s.createdAt) === weekStart).flatMap((s) => s.findings);
}

/** The rate (findings ÷ speech-hours) over a week's sessions — reuses `computeFocus`. */
function weekRate(sessions: readonly LetterSession[], weekStart: string): number {
  const inWeek = sessions.filter((s) => isoWeekStart(s.createdAt) === weekStart);
  return computeFocus(inWeek.map(toAnalyzed)).overallRatePerHour;
}

/**
 * Compose the letter for one ISO week (Monday→Sunday UTC). Reuses `computeFocus`
 * for the week's rate and the severity-weighted "what to work on next" ranking,
 * so the letter and the Focus map can never disagree. The trend compares this
 * week's rate to the *immediately preceding* calendar week; if that week had no
 * analyzed speech, `hasPrior` is false and the copy says so rather than inventing
 * a direction.
 */
export function composeWeek(sessions: readonly LetterSession[], weekStart: string): Letter {
  const inWeek = sessions.filter((s) => isoWeekStart(s.createdAt) === weekStart);
  const focus = computeFocus(inWeek.map(toAnalyzed));

  const priorStart = priorWeekStart(weekStart);
  const priorSessions = sessions.filter((s) => isoWeekStart(s.createdAt) === priorStart);
  const hasPrior = priorSessions.length > 0;
  const priorRate = hasPrior ? weekRate(sessions, priorStart) : null;

  const top = focus.ranking[0];
  const focusNext: LetterFocus | null =
    top && top.count > 0
      ? {
          category: top.category,
          count: top.count,
          ratePerHour: top.ratePerHour,
          weightedRatePerHour: top.weightedRatePerHour,
        }
      : null;

  return {
    weekStart,
    weekEnd: isoWeekEnd(weekStart),
    analyzedSessions: focus.analyzedSessions,
    speechHours: focus.speechHours,
    totalFindings: focus.totalFindings,
    ratePerHour: focus.overallRatePerHour,
    trend: {
      direction: hasPrior ? direction(priorRate as number, focus.overallRatePerHour) : "flat",
      hasPrior,
      current: focus.overallRatePerHour,
      prior: priorRate,
    },
    recasts: selectRecasts(weekFindings(sessions, weekStart)),
    focusNext,
  };
}

/** The most recent ISO week that has at least one analyzed finding, or null. */
export function latestWeekWithFindings(sessions: readonly LetterSession[]): string | null {
  let latest: string | null = null;
  for (const s of sessions) {
    if (s.findings.length === 0) continue;
    const week = isoWeekStart(s.createdAt);
    if (latest === null || week > latest) latest = week;
  }
  return latest;
}

/**
 * The letter for the most recent week with findings (or a named `week`). Returns
 * null when nothing has been analyzed — the screen's quiet empty state. Pure.
 */
export function computeLetter(sessions: readonly LetterSession[], week?: string): Letter | null {
  const weekStart = week ?? latestWeekWithFindings(sessions);
  if (weekStart === null) return null;
  return composeWeek(sessions, weekStart);
}

/**
 * Read every *analysed* session into the pure input rows via the canonical
 * read-model (lib/findings-model.ts): its capture date, its analysed speech time,
 * and its whole findings (the letter quotes them, so it needs the rows, not the
 * tallies). The scope — and with it the halted / re-analysis-in-flight semantics —
 * is the same one Focus, the Phrasebook, the Archive, the lesson patterns and card
 * generation read, so the letter can no longer report a different week from them.
 *
 * TWO queries for the whole database instead of three per session. The ISO-week
 * bucketing stays in the pure layer above: SQLite has no ISO-8601 week function
 * (`strftime('%W')` is not ISO), and `isoWeekStart` is unit-tested against
 * hand-computed boundaries.
 */
export function collectLetterSessions(db: Db): LetterSession[] {
  const bySession = new Map<string, LetterFinding[]>();
  for (const f of listIncludedFindings(db)) {
    const bucket = bySession.get(f.sessionId) ?? [];
    bucket.push({
      id: f.id,
      quote: f.quote,
      correction: f.correction,
      explanation: f.explanation,
      category: f.category,
      severity: f.severity,
    });
    bySession.set(f.sessionId, bucket);
  }
  return listAnalysedSessions(db).map((s) => ({
    id: s.id,
    createdAt: s.createdAt,
    speechMs: s.analysedSpeechMs,
    findings: bySession.get(s.id) ?? [],
  }));
}

/** The letter for the whole database — what the read route serves. */
export function buildLetter(db: Db, week?: string): Letter | null {
  return computeLetter(collectLetterSessions(db), week);
}
