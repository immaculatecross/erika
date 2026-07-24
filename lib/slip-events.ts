import type { Db } from "./db";

// [RETRO-003 T3] The time-aware "positive event" signal for slip green, extracted
// from lib/slips.ts to keep that file under the 500-line hook. Server-only DB glue.
//
// A slip's green (remission/resolved) requires a positive production/drill event
// whose TIMESTAMP POSTDATES the slip's last occurrence — not mere absence of
// recurrence, and not a snapshot with no time relation. The signal is the timestamped
// append-only `evidence` log (E-25/D-19), the one truth for production: a POSITIVE
// (polarity 1) CUED-or-SPONTANEOUS row sourced from one of the slip's findings
// (`source='finding'`, `source_ref` = the finding id — written by a passing drill on a
// knowledge-linked card and by E-28 spontaneous production). `recognition` and
// `again`/incorrect rows never count. Reading the LATEST such event per finding lets
// each slip call site compare it to that slip's own last occurrence, so a
// drill-then-recur fossil (drilled correctly, THEN heard again) stays active until it
// is re-produced correctly AFTER the recurrence — the `cards.last_grade` snapshot
// could not make that distinction.

/**
 * The `created_at` of the LATEST positive production/drill evidence event for each
 * finding that has one, keyed by finding id. A finding with no such event is absent.
 * The map is compared against a slip's last-occurrence timestamp at each call site.
 */
export function positiveEventTimeByFinding(db: Db): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT source_ref AS finding_id, MAX(created_at) AS at
         FROM evidence
        WHERE source = 'finding' AND source_ref IS NOT NULL
          AND polarity = 1 AND mode IN ('spontaneous','cued')
        GROUP BY source_ref`,
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
