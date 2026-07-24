import type { Db } from "../db";
import { compose, capsFromSettings } from "../compose";
import { localDay } from "../local-day";
import { getItem } from "../knowledge/items";
import { attemptCountsByDrill, latestScorableAttempt } from "./attempts";
import { listPronunciationDrills, type PronunciationDrill } from "./drills";
import { pronunciationThresholds, UNCALIBRATED_NOTICE, type PronunciationThresholds } from "./thresholds";
import type { KnowledgeStatus } from "../knowledge/types";

// The read-model behind the studio list (E-37). Zero model calls, zero money: it
// composes what the learner can drill today and what it has cost so far to know it.
//
// Two lanes:
//   * DRILLS — pronunciation findings from the learner's own recordings, each a
//     correct sentence to hear and say (lib/pronunciation/drills.ts, read through the
//     E-17 findings model), with their attempt history and last score.
//   * SOUNDS — the `phone:` items today's composer put at the learner's edge. These
//     exist because E-37 seeds them from real drill results, which is what finally
//     makes the Settings "Sounds" cap a live control instead of an inert knob.
//
// `scoringAvailable` carries the honest state of the OPTIONAL scoring layer: false
// means no Azure key is configured, which changes nothing about the studio's actual
// loop (hear the correct line → say it back → hear yourself). It only means no take
// can be given a number — and Erika never shows a number it did not measure.

export interface StudioDrillRow extends PronunciationDrill {
  /** How many takes have been scored for this drill. */
  attempts: number;
  /** The PronScore of the most recent scorable take, or null. */
  lastScore: number | null;
}

export interface StudioSoundRow {
  itemId: string;
  /** The phoneme symbol, as the scorer reported it. */
  symbol: string;
  status: KnowledgeStatus;
}

export interface StudioView {
  day: string;
  /** Whether the optional Azure scoring layer can run here. The drills work either way. */
  scoringAvailable: boolean;
  drills: StudioDrillRow[];
  sounds: StudioSoundRow[];
  thresholds: PronunciationThresholds;
  /** The honesty line shown wherever a score is (thresholds.ts). */
  notice: string;
}

/** The phoneme symbol a `phone:<symbol>` item id encodes. */
export function phoneSymbolOf(itemId: string): string {
  return itemId.startsWith("phone:") ? itemId.slice("phone:".length) : itemId;
}

export function buildStudioView(
  db: Db,
  opts: { scoringAvailable: boolean; day?: string } = { scoringAvailable: false },
): StudioView {
  const day = opts.day ?? localDay();
  const counts = attemptCountsByDrill(db);
  const drills = listPronunciationDrills(db).map((d): StudioDrillRow => {
    const last = latestScorableAttempt(db, d.drillKey);
    return { ...d, attempts: counts.get(d.drillKey) ?? 0, lastScore: last ? last.pronScore : null };
  });

  // The composer's own selection for today — the same plan (and the same idempotent
  // spill reconciliation) the Learn items surface reads.
  const plan = compose(db, day, capsFromSettings(db));
  const sounds: StudioSoundRow[] = [];
  for (const it of plan.items) {
    if (it.kind !== "pronunciation" || !it.itemId) continue;
    sounds.push({
      itemId: it.itemId,
      symbol: phoneSymbolOf(it.itemId),
      status: getItem(db, it.itemId)?.status ?? "unseen",
    });
  }

  return {
    day,
    scoringAvailable: opts.scoringAvailable,
    drills,
    sounds,
    thresholds: pronunciationThresholds(),
    notice: UNCALIBRATED_NOTICE,
  };
}
