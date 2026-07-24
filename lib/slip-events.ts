import type { Db } from "./db";

// [RETRO-003 T3 · repaired RETRO-004] The time-aware "positive event" signal for
// slip green, extracted from lib/slips.ts to keep that file under the 500-line hook.
// Server-only DB glue.
//
// A slip's green (remission/resolved) requires a positive production/drill event
// whose TIMESTAMP POSTDATES the slip's last occurrence — not mere absence of
// recurrence, and not a snapshot with no time relation. The event PRODUCTION actually
// writes is a PASSING card grade: `gradeCard` (lib/cards.ts) stamps `last_grade` and
// sets `due = datetime('now', '+' || interval_days || ' days')` on EVERY grade, so the
// instant of the latest grade is recoverable as `due - interval_days` — an exact,
// migration-free timestamp for a real production event (intervals are whole days,
// lib/srs.ts). A grade of `good`/`easy` is the positive event; `again` (a lapse, which
// zeroes the interval) and `hard` (a shaky pass) never count. Reading that instant per
// finding lets each slip call site compare it to that slip's own last occurrence, so a
// drill-then-recur fossil (drilled correctly, THEN heard again) stays active until it
// is re-produced correctly AFTER the recurrence — a bare `cards.last_grade` snapshot
// could not make that distinction.
//
// Truthfulness note: this signal does NOT read the `evidence` log, and cannot. An
// `evidence` row demands a validated `knowledge_items.item_id`, which a drill card
// only carries once something populates `cards.item_id` — nothing in shipped code
// does — and E-28's produced-lemma rows are lemma-keyed with `source_ref = NULL`, so
// they carry no finding link and could never key a slip. Reading the card grade
// directly, by finding id, is the one green signal production reaches today.

/**
 * The instant of the LATEST passing drill grade for each finding whose card has one,
 * keyed by finding id. `gradeCard` writes `due = grade_instant + interval_days`, so
 * `due - interval_days` recovers exactly when the (good/easy) grade happened. A finding
 * whose card was never passed — ungraded, or last graded `again`/`hard` — is absent.
 * The map is compared against a slip's last-occurrence timestamp at each call site.
 */
export function positiveEventTimeByFinding(db: Db): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT finding_id AS finding_id,
              datetime(due, '-' || interval_days || ' days') AS at
         FROM cards
        WHERE last_grade IN ('good','easy')`,
    )
    .all() as { finding_id: string; at: string }[];
  return new Map(rows.map((r) => [r.finding_id, r.at]));
}

/** Whether any of `findingIds` carries a positive production/drill event dated
 *  strictly AFTER `lastOccurrenceAt` — the time-aware green gate ([T3]). */
export function hasPositiveEventAfter(
  eventTimeByFinding: Map<string, string>,
  findingIds: readonly string[],
  lastOccurrenceAt: string,
): boolean {
  return findingIds.some((fid) => {
    const at = eventTimeByFinding.get(fid);
    return at !== undefined && at > lastOccurrenceAt;
  });
}

/** The finding ids associated with each slip, keyed by slip id (finding_slips). */
export function findingIdsBySlip(db: Db): Map<string, string[]> {
  const rows = db.prepare("SELECT slip_id, finding_id FROM finding_slips").all() as {
    slip_id: string;
    finding_id: string;
  }[];
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const bucket = map.get(r.slip_id);
    if (bucket) bucket.push(r.finding_id);
    else map.set(r.slip_id, [r.finding_id]);
  }
  return map;
}
