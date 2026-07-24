// The local-day basis for the daily habit layer (D-24, E-31). CLIENT-SAFE: pure
// date arithmetic, no I/O — the composer, the day ledger and the Learn home all
// key "today" through here so there is exactly ONE definition of a day boundary.
//
// TIMEZONE STANCE (explicit, per D-24 and the E-22 UTC lesson). A streak day is a
// LOCAL calendar day, never a UTC day: a review at 11pm and one at 1am the next
// morning must land on two different days for the person living them, and a UTC
// key would fold them together (or split a single evening) for anyone west of
// Greenwich. Every *timestamp* in the database stays UTC text (`datetime('now')`,
// so rows still sort and compare as strings — that invariant is untouched); only
// the day KEY the ledger and the ring reduce a timestamp to is local.
//
// "Local" is the machine Erika runs on. Erika is single-user and local-first
// (D-2): the server and the person share one clock, so the server's local
// timezone IS the user's, and `Date`'s local getters are the source of truth.
// When Erika is hosted (E-40) this stance is revisited — a hosted server's clock
// is not the user's — and this is the one seam that has to change, which is why it
// lives alone in a documented module rather than scattered across call sites.

/** The local calendar day of `at` (default: now) as "YYYY-MM-DD". Uses the local
 *  timezone of the process — the user's machine (D-2). */
export function localDay(at: Date = new Date()): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  const d = String(at.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** The local day exactly one calendar day after `day` ("YYYY-MM-DD" → "YYYY-MM-DD").
 *  Parsed at local noon so a DST shift never rolls the date backward or forward. */
export function nextLocalDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(y, m - 1, d, 12, 0, 0, 0);
  at.setDate(at.getDate() + 1);
  return localDay(at);
}

/** The local day exactly one calendar day BEFORE `day`. Parsed at local noon for
 *  the same reason `nextLocalDay` is: a DST shift must never move the date. */
export function previousLocalDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(y, m - 1, d, 12, 0, 0, 0);
  at.setDate(at.getDate() - 1);
  return localDay(at);
}

/** Whether `day` is a well-formed "YYYY-MM-DD" key. */
export function isLocalDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}

/** The local calendar MONTH key of a local day ("YYYY-MM-DD" → "YYYY-MM"). The
 *  streak's repair credits are granted per calendar month (D-24), and a month is
 *  local for exactly the reason a day is: it is the month the person lived. */
export function localMonth(day: string): string {
  return day.slice(0, 7);
}

/** The epoch-ms half-open interval [start, end) a local day occupies. The inverse
 *  of `localDay`, for prefiltering UTC timestamp columns down to one local day
 *  before the exact per-row reduction. `Date` normalizes the DST-shortened and
 *  DST-lengthened days for us, so the interval is always the real one. */
export function localDayBoundsUtc(day: string): { startMs: number; endMs: number } {
  const [y, m, d] = day.split("-").map(Number);
  return {
    startMs: new Date(y, m - 1, d, 0, 0, 0, 0).getTime(),
    endMs: new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime(),
  };
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** The short weekday name of a local day key ("2026-07-21" → "Tue"). Parsed at
 *  local noon (the DST-safe parse), locale-free so it is deterministic in tests. */
export function localWeekday(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d, 12, 0, 0, 0).getDay()];
}

/**
 * The local hour of day (0..23) an instant fell on — the hour the learner's own
 * clock showed. The second consumer of this seam after `localDay`: "when you slip"
 * (E-22) binned by UTC hour, which is not a time anyone lived through (RETRO-003,
 * D-24 — the user's day is local).
 *
 * THE DST ANSWER (the question the old UTC comment raised, answered rather than
 * avoided). `Date#getHours()` maps every instant to exactly one wall-clock hour, so
 * the mapping stays total and single-valued across both transitions:
 *
 *  · SPRING FORWARD (the SKIPPED hour — e.g. 02:00→03:00 local). That local hour
 *    simply never happened on that date, so its bucket receives nothing from that
 *    day. Nothing is lost or misplaced: no instant exists to be binned, and every
 *    instant that does exist still lands in a real hour.
 *  · FALL BACK (the AMBIGUOUS/REPEATED hour — e.g. 02:00 happens twice). Both
 *    passes report the same wall-clock hour, so that bucket covers two real hours
 *    on that one date. Counts stay additive: nothing is dropped and nothing is
 *    double-counted — the bucket is simply, and correctly, twice as wide once.
 *
 * Σ(buckets) is therefore conserved on every date, which is the property the
 * distribution actually depends on. The residual distortion is one bucket on two
 * dates a year, and it is the RIGHT trade: the question the histogram answers is
 * "what time was it for me when I slipped", and a UTC hour answers a question
 * nobody asked. (Reading local time is also what makes this seam the single one
 * that has to change when Erika is hosted — see the stance note above.)
 */
export function localHour(at: Date): number {
  return at.getHours();
}
