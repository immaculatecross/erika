// THE one rule for "when did the learner speak?" (E-39 §B2, RETRO-004 Tier 1 §4).
//
// WHY THIS FILE EXISTS. `sessions.created_at` is the UPLOAD instant — a bare SQLite
// `DEFAULT (datetime('now'))` that `createSession` never overrides — and eight surfaces
// were reading it as the moment the learner spoke. The headline case is the one the
// product is built around: record at 08:10, upload after dinner at 21:30, and Erika
// asserts "you used it in THIS EVENING's recording", while an evening upload of the
// morning's speech lands on the wrong local day outright. Focus's "when you slip"
// histogram collapses to a single spike at the hour the learner uploads. The session
// page's field is literally labelled "Captured".
//
// THE INVARIANT: **every claim about when the learner spoke is derived from when they
// spoke — and where that is unknown, the claim is not made.** The second half matters as
// much as the first; it is the half that stops this being a field swap.
//
// WHERE CAPTURE TIME COMES FROM, in the order we trust it, and why:
//
//   1. THE APP ITSELF, at capture. The in-app recorder knows the instant it started;
//      `POST /api/sessions` and the tus metadata carry it (`x-captured-at`). This is a
//      measurement, not an inference — the strongest source there is.
//   2. THE CONTAINER'S OWN `creation_time` TAG, read by ffprobe. A phone or field
//      recorder writes when IT started recording. Also a measurement, made by the device
//      that did the recording.
//   3. NOTHING. NULL.
//
// WHAT IS DELIBERATELY NOT USED, because getting this wrong is the whole defect:
//
//   * `File.lastModified` — available in the browser and currently discarded. An mtime is
//     a fact about a FILE, not about a recording: copying, syncing, unzipping, converting
//     or editing rewrites it, and nothing marks that it happened. Substituting it would
//     re-introduce exactly the class of confident-and-wrong claim this fix removes, only
//     harder to notice than the upload instant it replaced.
//   * `created_at` as a fallback for a CLAIM. That is the bug.
//
// TWO KINDS OF CONSUMER, which is why this module publishes two things:
//
//   * A CLAIM ABOUT THE LEARNER'S CLOCK — "this morning's recording", the hour-of-day
//     histogram, a field labelled "Captured". These read `capturedAt` and REFUSE when it
//     is null. `lib/today-thread.ts` already had precisely this stance ("no capture time
//     ⇒ never cited"); it was simply pointed at the wrong column.
//   * FILING AND ORDERING — which session is newest, which week a finding belongs to, the
//     Archive's day groups, "last heard". These need a monotone key for every session,
//     including the ones whose capture time is unknown, and refusing here would empty the
//     Archive and the letter on a fresh install: an over-refusal is as wrong as an
//     over-claim. They read `TIMELINE_AT_SQL` — capture time when known, the upload
//     instant when not — and any surface that PRINTS that instant prints it with the
//     label `capturePrecision` gives it, so the screen never says "captured" about a time
//     that is not.

/** Which fact a displayed session instant actually is. */
export type CapturePrecision = "captured" | "uploaded";

/**
 * SQL: the instant to FILE a session under. Capture time when the recording told us,
 * the upload instant otherwise — so no session ever falls out of a list, a week or a
 * day group. Never use this for a claim about the hour the learner spoke; use
 * `CAPTURED_AT_SQL` and refuse on null.
 */
export const TIMELINE_AT_SQL = "COALESCE(s.captured_at, s.created_at)";

/** SQL: when the learner spoke, or NULL when we do not know. The basis of every claim. */
export const CAPTURED_AT_SQL = "s.captured_at";

/** Is a displayed instant a real capture time, or just when the file arrived? */
export function capturePrecision(capturedAt: string | null | undefined): CapturePrecision {
  return capturedAt ? "captured" : "uploaded";
}

/** The label a displayed session instant may honestly carry. */
export function captureLabel(capturedAt: string | null | undefined): string {
  return capturePrecision(capturedAt) === "captured" ? "Captured" : "Uploaded";
}

// ---- reading a capture time off the wire / out of a container ----------------

/**
 * Normalise a claimed capture instant to the SQLite UTC text the schema uses, or null.
 *
 * Rejects, rather than coerces, anything it cannot stand behind: unparseable text, and
 * an instant in the FUTURE (beyond a minute of clock skew) — a client clock set to 2093
 * must not put a session at the top of every list forever. An instant far in the past is
 * accepted: a genuinely old recording is a normal thing to upload.
 */
export function normalizeCapturedAt(
  claimed: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!claimed) return null;
  const ms = Date.parse(claimed);
  if (!Number.isFinite(ms)) return null;
  if (ms > now + 60_000) return null;
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * The container's own `creation_time` tag, as ffprobe reports it, normalised — or null.
 *
 * ffprobe prints the tag verbatim from the file; MP4/MOV/M4A write an ISO-8601 UTC
 * instant, and some encoders write the placeholder `1970-01-01T00:00:00.000000Z`, which
 * is not a recording that happened at the epoch and is refused as the non-answer it is.
 */
export function parseContainerCreationTime(
  raw: string | null | undefined,
  now: number = Date.now(),
): string | null {
  const text = (raw ?? "").trim();
  if (text === "" || text.startsWith("1970-01-01")) return null;
  return normalizeCapturedAt(text, now);
}
