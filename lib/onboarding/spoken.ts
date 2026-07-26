import { createHash } from "node:crypto";
import type { Db } from "../db";
import { openAiAudioModel, type AudioModelClient } from "../analysis/audio-model";
import { ModelParseError } from "../analysis/model-errors";
import { withRepair, BudgetHalt } from "../analysis/reserved-call";
import { finalizeReservation } from "../analysis/budget";
import { callCost, MINI_MODEL } from "../analysis/rates";
import { hasAnalysisKey } from "../env-file";
import { readSettings } from "../settings";
import { bandIndex, invalidatesMeasurement, type Band, type PlacementCaveat } from "../placement/scoring";

// The spoken half of placement (E-46 criteria 3, 10, 11).
//
// WHAT IT CHANGES, said plainly, because criterion 10 asks for exactly this and the
// tempting answer is a lie. The vocabulary check is untouched: its scoring, its
// thresholds and its refusals are `lib/placement/scoring.ts` and this file does not
// import a single decision from them, only their vocabulary. What the spoken sample
// does is supply a SECOND, independent level — measured on production, not on
// recognition — and the two are combined by one rule:
//
//     the placed level is the HIGHER of the two.
//
// That rule earns its keep in exactly two situations, and does nothing in the rest:
//
//  1. The check REFUSED to measure (`response-style` / `no-control`). That is the
//     yes-biased advanced learner: they said yes to the invented words too, so the
//     scorer correctly declined to level them and — until now — offered no way out
//     but taking the same check again (RETRO-004 §1, the last open item). Here the
//     check contributes nothing, so the spoken band IS the level, and the learner is
//     placed and seeded from speech instead of being sent round the loop.
//  2. The check measured LOW and the speech is plainly better. Recognition
//     under-reads a learner who talks more than they read. Taking the higher band
//     moves them off the A1 opener.
//
// And it can never do harm: it only ever RAISES. A calibrated B2 check cannot be
// dragged down by a model that mis-heard a noisy room, and a learner who declines to
// speak, has no microphone, denies permission or has no API key is placed by the
// check alone, exactly as before (criterion 11). The band the model returns is coarse
// on purpose (see ./spoken-parse) and is refused outright when it says the sample was
// too thin to judge.
//
// Money: one `gpt-audio-mini` call on a ≤60 s clip, priced by `callCost` and put
// through the same reserve-before-call spine as every other billable call. Over the
// cap it does not fire at all, and the learner is placed by the check.

export type SpokenUnavailable = "no-key" | "over-cap" | "failed" | "unsupported";

export type SpokenOutcome =
  /** The model heard the sample and committed to a band. */
  | { status: "measured"; band: Band }
  /** The model heard it and would not commit — too short, too quiet, wrong language. */
  | { status: "unusable" }
  /** No measurement was even attempted, and why. Never dressed as a level. */
  | { status: "unavailable"; reason: SpokenUnavailable };

export interface SpokenSample {
  audioBase64: string;
  format: string;
  /** Clip length, used only to price the call. */
  durationMs: number;
}

/**
 * Judge one spoken sample. Reserve-before-call, so the hard cap holds; a resolved
 * but unreadable reply still bills (the `ModelParseError` contract) and reports
 * `failed` rather than a guess.
 */
export async function listenForPlacement(
  db: Db,
  sample: SpokenSample,
  client: AudioModelClient = openAiAudioModel,
): Promise<SpokenOutcome> {
  if (!hasAnalysisKey()) return { status: "unavailable", reason: "no-key" };
  if (!client.placementListen) return { status: "unavailable", reason: "unsupported" };
  const settings = readSettings(db);
  const costUsd = callCost(MINI_MODEL, sample.durationMs);
  const contentHash = createHash("sha256").update(sample.audioBase64).digest("hex");
  const listen = client.placementListen.bind(client);
  try {
    const { result, reservation } = await withRepair(
      db,
      MINI_MODEL,
      contentHash,
      costUsd,
      settings.monthlyBudgetUsd,
      (opts) =>
        listen(
          { audioBase64: sample.audioBase64, format: sample.format, targetLanguage: settings.targetLanguage },
          opts,
        ),
    );
    // The call resolved and is charged; there is no witness row to ride with, so it
    // is committed here rather than left pending for a sweep to guess at.
    finalizeReservation(db, reservation);
    return result.usable && result.band ? { status: "measured", band: result.band } : { status: "unusable" };
  } catch (err) {
    if (err instanceof BudgetHalt) return { status: "unavailable", reason: "over-cap" };
    // Even after the repair the reply was unreadable. Both attempts resolved and both
    // are charged (the `reservedCall` contract); the learner is told the take could
    // not be listened to, and the word check places them.
    if (err instanceof ModelParseError) return { status: "unavailable", reason: "failed" };
    return { status: "unavailable", reason: "failed" };
  }
}

export interface ResolvedLevel {
  level: Band | null;
  /** Which measurement the level came from — the honest provenance for the copy. */
  source: "check" | "spoken" | "none";
}

/**
 * Combine the two measurements. Pure, so the one rule that decides what a learner is
 * placed at can be mutated and tested without a database or a model.
 *
 * An INVALIDATED check contributes nothing at all — not its level, not a floor. That
 * is the whole point of the refusal: a response style is not a measurement, so it may
 * not become one by being averaged with something real.
 */
export function resolveLevel(
  check: { level: Band | null; caveat: PlacementCaveat | null },
  spokenBand: Band | null,
): ResolvedLevel {
  const checkLevel = invalidatesMeasurement(check.caveat) ? null : check.level;
  if (checkLevel === null && spokenBand === null) return { level: null, source: "none" };
  if (checkLevel === null) return { level: spokenBand, source: "spoken" };
  if (spokenBand === null) return { level: checkLevel, source: "check" };
  return bandIndex(spokenBand) > bandIndex(checkLevel)
    ? { level: spokenBand, source: "spoken" }
    : { level: checkLevel, source: "check" };
}
