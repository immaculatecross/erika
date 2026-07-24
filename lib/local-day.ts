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

/** Whether `day` is a well-formed "YYYY-MM-DD" key. */
export function isLocalDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day);
}
