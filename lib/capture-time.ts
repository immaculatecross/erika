// WHEN THE LEARNER SPOKE — one module, one invariant (E-42 criteria 5 and 6).
//
// THE INVARIANT: every claim Erika makes about when the learner SPOKE reads
// `sessions.captured_at`; `sessions.created_at` may only be read as what it is —
// the instant the row was made, i.e. when the upload finished. The two are not
// interchangeable and Erika's own design is why: capture is day-scale and
// asynchronous (D-9), so a take recorded at 08:10 and uploaded at 21:30 differs
// by thirteen hours. Reading the wrong one made "this morning's recording" say
// "this evening" and put Focus's local-hour histogram in the wrong buckets.
//
// AND THE OPPOSITE FAILURE, because five v0.6 repairs created their own mirror
// image: swapping every `created_at` for `captured_at` would be just as wrong.
// A job's age, an evidence row's mint time, a spend row's month, the order rows
// were written in — those are all genuinely about the row, and a "fix" that moved
// them to capture time would make a resumed ingest look stale and a month's spend
// land in the wrong month. So this module exports the SQL for the spoke-instant
// and nothing else; the enumeration of which call sites are which is in the PR.
//
// No Node imports: the client-side transport helpers below share this file with
// the server, so both ends agree on the wire format and the sanity rules.

/** How far into the future a declared capture instant may sit before it is
 *  refused. A browser clock and the server clock are never exactly aligned, and a
 *  mic take's start instant is stamped by the browser; a couple of minutes of skew
 *  is ordinary, an hour is a wrong clock we must not believe. */
export const CAPTURE_FUTURE_SKEW_MS = 2 * 60 * 1000;

/** The earliest capture instant that is not obviously junk (2000-01-01 UTC).
 *  Container metadata is a rich source of zero/epoch/1904 timestamps; believing one
 *  would put a recording decades in the past and silently empty every day bucket. */
export const CAPTURE_EPOCH_FLOOR_MS = Date.UTC(2000, 0, 1);

/**
 * SQL for the instant the learner spoke, for a `sessions` row aliased `alias`.
 *
 * One dialect, exported once. Two v0.6 defects came from the same rule being
 * written twice in two languages and then drifting apart, so every reader that
 * needs the spoken instant composes THIS, and `tests/capture-time.test.ts` asserts
 * that no other query in the app reads a session's `created_at` as a capture time.
 *
 * The COALESCE is a safety floor, not a shrug: v28 backfills every existing row and
 * every write path sets the column, so it should never fire — but if it ever does,
 * falling back to `created_at` is the best value that exists, and it keeps the row
 * IN the result set. A bare `captured_at` would let one NULL quietly delete a
 * recording from a histogram, which is the failure this whole module exists to stop.
 */
export function capturedAtSql(alias = "s"): string {
  return `COALESCE(${alias}.captured_at, ${alias}.created_at)`;
}

/** SQLite UTC text ("YYYY-MM-DD HH:MM:SS") for an epoch instant. */
export function toSqliteUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Parse a declared capture instant into epoch ms, or null.
 *
 * Accepts an ISO-8601 string (what a browser and ffprobe both produce) and the
 * SQLite UTC text this app stores, which is ISO without the `T` and the zone — so
 * it is normalised before parsing rather than being read as local time.
 */
export function parseCaptureInstant(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text === "") return null;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is `ms` a capture instant we are willing to believe? It must be a real instant,
 * not from before this century, and not meaningfully in the future.
 *
 * The direction that matters: a WRONG capture time is worse than a merely IMPRECISE
 * one. The fallback (the upload instant) is always available and is always ≥ the
 * true capture time, so refusing a doubtful value costs at most the old behaviour,
 * while believing one puts a recording in a day the learner did not live through.
 */
export function isSaneCaptureInstant(ms: number, nowMs: number = Date.now()): boolean {
  if (!Number.isFinite(ms)) return false;
  if (ms < CAPTURE_EPOCH_FLOOR_MS) return false;
  return ms <= nowMs + CAPTURE_FUTURE_SKEW_MS;
}

/** The declared capture instants a finalize call may have to choose between. */
export interface CaptureCandidates {
  /**
   * The instant the take STARTED, declared by the client that recorded it. This is
   * the mic path and it is authoritative: the browser knows exactly when the user
   * pressed record, and nothing downstream knows better.
   */
  declared?: string | null;
  /**
   * A container's embedded `creation_time` (ffprobe). Present on m4a/mp4/mov from
   * phone recorders; absent from most wav and mp3. Authoritative when present —
   * the recorder itself wrote it.
   */
  embedded?: string | null;
  /**
   * A weaker HINT: the picked file's own modification time, as the browser reports
   * it. A recorder app writes the file when the recording ends, so mtime is close
   * to capture — and it is never further from the truth than the upload instant,
   * which is the alternative. It ranks BELOW embedded metadata because a copy or an
   * edit can move an mtime, and it is never allowed to move a capture time LATER
   * than the fallback would have put it (see `resolveCapturedAt`).
   */
  hint?: string | null;
}

/**
 * Resolve the one instant to store as `sessions.captured_at`, in SQLite UTC text.
 *
 * Order (criterion 5): the client's declared take-start → the container's embedded
 * creation time → the file's modification-time hint → `now`, the upload instant.
 * Every candidate must pass `isSaneCaptureInstant`; an unusable one is skipped
 * rather than failing the upload, because a bad clock must never cost a learner
 * their recording.
 *
 * `now` is the floor's value and also a CEILING for the hint: a mtime in the future
 * relative to the upload is a clock artefact, and a "capture time" after the upload
 * instant is not a capture time. The declared and embedded values are already bounded
 * by the same skew rule.
 */
export function resolveCapturedAt(c: CaptureCandidates, now: Date = new Date()): string {
  const nowMs = now.getTime();
  for (const raw of [c.declared, c.embedded]) {
    const ms = parseCaptureInstant(raw);
    if (ms !== null && isSaneCaptureInstant(ms, nowMs)) return toSqliteUtc(ms);
  }
  const hintMs = parseCaptureInstant(c.hint);
  if (hintMs !== null && isSaneCaptureInstant(hintMs, nowMs) && hintMs <= nowMs) {
    return toSqliteUtc(hintMs);
  }
  return toSqliteUtc(nowMs);
}

// ---- the wire ------------------------------------------------------------
//
// Both upload transports carry the same two values under the same two names, so
// the mic path and the file path reach `resolveCapturedAt` with identical inputs
// whichever one delivered the bytes (D-25's "same bytes in, same end state out").

/** Header/tus-metadata key for the authoritative declared take-start instant. */
export const CAPTURED_AT_KEY = "capturedAt";
/** Header/tus-metadata key for the weaker file-modification-time hint. */
export const CAPTURED_AT_HINT_KEY = "capturedAtHint";
/** The streamed-POST header names (lower-case, as headers are matched). */
export const CAPTURED_AT_HEADER = "x-captured-at";
export const CAPTURED_AT_HINT_HEADER = "x-captured-at-hint";
