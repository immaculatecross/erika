// The pure "standing + copy" core of E-20 slips, extracted from lib/slips.ts to
// keep that file under the 500-line hook. Client-safe: no I/O — the active /
// remission / resolved state machine and the one quiet status line it wears. The
// DB glue in lib/slips.ts feeds it, and re-exports every name here so existing
// imports (`@/lib/slips`) are unchanged.

/** A slip is resolved after this many clean *analysed* sessions since its last
 *  occurrence. Below this (but > 0) it is in remission; 0 clean = still active. */
export const RESOLVED_CLEAN_SESSIONS = 3;

/** active = seen in the latest analysed session · remission = clean but < N ·
 *  resolved = clean for ≥ N analysed sessions. Green attaches only to the last two. */
export type SlipState = "active" | "remission" | "resolved";

/** A slip's computed standing: its state and the evidence behind it. */
export interface SlipStanding {
  state: SlipState;
  /** The `created_at` of the most recent session this slip occurred in. */
  lastOccurrenceAt: string;
  /** Analysed sessions strictly after the last occurrence — all necessarily clean. */
  cleanSessionsSince: number;
}

/**
 * Compute a slip's state from its last occurrence and the analysed sessions that
 * came after it. Every analysed session later than the last occurrence is clean by
 * construction (the slip did not recur in it), so the count of those is the whole
 * story: ≥ N ⇒ resolved, 1..N-1 ⇒ remission, 0 ⇒ still active. "Analysed" is the
 * canonical read-model's definition, so a FAILED run's completed segments count
 * exactly like a done run's — nothing about stopping early un-says the evidence.
 *
 * [RETRO-002 P3 / RETRO-003 T3] Green (remission OR resolved) is GATED on a positive
 * production/drill event, not on mere absence of recurrence. Green is mastery
 * (D-14/D-24), and a slip that simply stopped appearing has not been shown to be
 * fixed — the speaker may just have stopped using the construction. So a clean
 * streak with `hasPositiveEvent === false` stays `active` however long it runs;
 * green only attaches once the correct form has been produced or drilled correctly.
 * [T3] the DB glue supplies this flag from the TIMESTAMPED passing drill grade — the
 * instant `gradeCard` records as `due - interval_days` (lib/slip-events.ts) — and only
 * for a grade whose timestamp POSTDATES this slip's last occurrence, so a slip drilled
 * correctly and THEN heard again (a fossil) stays active until it is re-produced
 * correctly after the recurrence, which a bare `cards.last_grade` snapshot could not
 * distinguish. Default `true` keeps the pure-clustering call sites and their tests
 * unchanged; production always passes the real, time-aware value.
 */
export function computeSlipStanding(
  lastOccurrenceAt: string,
  analysedSessionDates: readonly string[],
  hasPositiveEvent = true,
): SlipStanding {
  const clean = analysedSessionDates.filter((d) => d > lastOccurrenceAt).length;
  const green = hasPositiveEvent && clean > 0;
  const state: SlipState = !green
    ? "active"
    : clean >= RESOLVED_CLEAN_SESSIONS
      ? "resolved"
      : "remission";
  return { state, lastOccurrenceAt, cleanSessionsSince: clean };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A SQLite UTC timestamp → a short, locale-free "13 Jul" (deterministic in tests). */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}

/** The one quiet status line a slip wears — real dates, never a cheer (DESIGN). */
export function statusLine(standing: SlipStanding): string {
  const since = shortDate(standing.lastOccurrenceAt);
  if (standing.state === "active") return `Still active — last heard ${since}`;
  const n = standing.cleanSessionsSince;
  return `Not heard since ${since} · ${n} ${n === 1 ? "session" : "sessions"} clean`;
}
