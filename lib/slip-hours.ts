// "When you slip" — the wall-clock hour-of-day distribution of findings (E-22
// criterion 3). A pure function of typed rows so every bucket is unit-testable
// against hand-computed fixtures, including the empty case. No DB, no model call.
//
// Timezone basis: the LEARNER'S LOCAL HOUR (E-38, RETRO-003 — this used to bin by
// `getUTCHours()`). The old basis was internally consistent and still wrong for the
// question: nobody slips "at 07:00 UTC", and a learner an hour or eight off
// Greenwich was shown a histogram whose peak was not a time they had lived through.
// D-24 settles it — the user's day is local — and `lib/local-day.ts` is the one seam
// that knows what local means (the same seam the streak and the day ledger key on,
// and the one place that changes when Erika is hosted, E-40).
//
// DST is answered rather than avoided, in `localHour`'s doc comment: the skipped
// spring-forward hour simply receives nothing, the repeated fall-back hour is one
// bucket twice as wide for one date, and Σ(buckets) is conserved either way. See
// lib/local-day.ts.
//
// The moment a slip happened is the session's capture time plus the finding's offset
// into the recording; that sum is taken in epoch ms (so an offset that crosses an
// hour or midnight boundary lands in the correct next bucket) and only then read as
// a local hour.

import { localHour } from "./local-day";

export const HOURS_IN_DAY = 24;

/** One finding reduced to what the distribution needs. */
export interface SlipHourInput {
  /** The owning session's SQLite UTC capture time ("YYYY-MM-DD HH:MM:SS"). */
  sessionCreatedAt: string;
  /** The finding's offset into the recording, in ms. */
  startMs: number;
}

/** The 24-hour distribution: the buckets plus the summary the UI reads. */
export interface SlipHourDistribution {
  /** Exactly 24 counts, index = LOCAL hour of day (0..23). Never NaN. */
  buckets: number[];
  /** Σ of the buckets — findings that carried a readable timestamp. */
  total: number;
  /** The hour with the most slips, or null when there are none. */
  peakHour: number | null;
  /** How many slips fell in the peak hour (0 when empty). */
  peakCount: number;
}

/** SQLite UTC text ("YYYY-MM-DD HH:MM:SS") → epoch ms, or null if unparseable. */
function parseUtc(value: string): number | null {
  const ms = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Bucket findings by the learner's LOCAL hour of day into 24 buckets. A finding
 * whose session timestamp cannot be parsed is skipped rather than corrupting a
 * bucket with NaN; the empty input returns 24 zeros with a null peak.
 */
export function slipHourDistribution(findings: readonly SlipHourInput[]): SlipHourDistribution {
  const buckets = new Array<number>(HOURS_IN_DAY).fill(0);
  for (const f of findings) {
    const base = parseUtc(f.sessionCreatedAt);
    if (base === null) continue;
    const hour = localHour(new Date(base + Math.max(0, f.startMs)));
    buckets[hour] += 1;
  }
  const total = buckets.reduce((sum, n) => sum + n, 0);
  let peakHour: number | null = null;
  let peakCount = 0;
  buckets.forEach((n, h) => {
    if (n > peakCount) {
      peakCount = n;
      peakHour = h;
    }
  });
  return { buckets, total, peakHour, peakCount };
}
