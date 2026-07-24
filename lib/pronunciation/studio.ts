import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Db } from "../db";
import { readSettings } from "../settings";
import { BudgetExceededError } from "../lessons/billing";
import { insertAttempt, getAttempt, type PronunciationAttempt } from "./attempts";
import { applyAttemptToKnowledge } from "./knowledge";
import {
  estimatePronunciationUsd,
  finalizePronunciationLease,
  openPronunciationLease,
  releasePronunciationLease,
} from "./money";
import { PronunciationParseError, type PronunciationScorer } from "./scorer";
import { isTooNoisy, pronunciationThresholds } from "./thresholds";
import { MAX_DRILL_SECONDS } from "./types";
import type { PronunciationDrill } from "./drills";

export { BudgetExceededError } from "../lessons/billing";

// The pronunciation studio's orchestration (E-37) — the one place a drill take turns
// into money, a stored attempt, and knowledge.
//
// ORDERING IS THE WHOLE POINT (WO criterion 2, never-waivable):
//
//   refuse-before-reserve → RESERVE → call → settle → persist
//
//   1. A scorer that cannot run (no `AZURE_SPEECH_KEY`) throws the honest wall BEFORE
//      anything is reserved: no charge, no score, no fabricated number.
//   2. A take longer than the REST short-audio cap is refused BEFORE anything is
//      reserved: an over-long recording costs nothing.
//   3. `openPronunciationLease` reserves the estimated cost as a PENDING ledger row —
//      atomically, committed + pending ≤ cap — BEFORE the request leaves. If the cap
//      refuses it, `BudgetExceededError` is thrown with NO call made, so the learner
//      gets a truthful refusal and the month gets neither a charge nor a score.
//   4. The call resolves:
//        * success → finalize at the ACTUAL audio duration and store the attempt in
//          ONE transaction. The charge and its record commit together or not at all.
//        * `PronunciationParseError` → Azure answered, so Azure billed: FINALIZE the
//          reservation (never release) and rethrow. No attempt is stored — there is no
//          score — but the money is recorded (E-16 defect 4, applied to Azure).
//        * anything else (unavailable / network) → nothing was charged: RELEASE.
//   5. A crash between 3 and 4 leaves a pending `pa:` row that the startup sweep
//      COMMITS rather than releases (lib/analysis/budget.ts `isAssumedRunLeaseHash`) —
//      spend is recorded even when the process dies mid-call.
//
// The scorer is a PARAMETER (the seam) — this module never imports a concrete scorer,
// so every branch above is tested against committed fixtures with zero egress.

/** A take that exceeds Azure's REST short-audio limit. Refused before any spend. */
export class DrillTooLongError extends Error {
  constructor(seconds: number) {
    super(`A drill take may be at most ${MAX_DRILL_SECONDS}s; this one is ${seconds.toFixed(1)}s.`);
  }
}

/** The scorer is not configured here — the honest missing-key wall. */
export class ScorerUnavailableError extends Error {}

export interface ScoreAttemptInput {
  drill: PronunciationDrill;
  /** 16 kHz mono WAV on disk — the caller normalizes before this point. */
  audioPath: string;
  /** Measured duration of that file, in seconds. Both the reserved estimate and the
   *  finalized charge are computed from it. */
  audioSeconds: number;
  /** The attempt id to use. The route mints it first so the take's FILENAME and the
   *  attempt (and therefore its `pa:<id>` ledger lease) share one identifier; omitted,
   *  one is minted here. */
  attemptId?: string;
}

export interface ScoreAttemptOutcome {
  attempt: PronunciationAttempt;
  /** Phone items seeded / credited by this take (see ./knowledge.ts). */
  seeded: string[];
  credited: string[];
}

/**
 * Assess one recorded take of one scripted drill, billing it correctly.
 *
 * Throws (never returns a partial result): `ScorerUnavailableError` when no key is
 * configured, `DrillTooLongError` when the take exceeds the short-audio cap,
 * `BudgetExceededError` when the monthly cap refuses the reservation (no call, no
 * charge, no score), `PronunciationParseError` when Azure answered unreadably (the
 * charge IS recorded), or the underlying transport error when nothing was charged.
 */
export async function scoreAttempt(
  db: Db,
  scorer: PronunciationScorer,
  input: ScoreAttemptInput,
): Promise<ScoreAttemptOutcome> {
  // (1) The honest wall — before any reservation, so an unconfigured install can
  // never leave a pending row, and never shows a number it did not measure.
  if (!scorer.isAvailable()) {
    throw new ScorerUnavailableError(
      "Pronunciation scoring is not configured: no Azure Speech key is set on this server.",
    );
  }
  // (2) Refuse an over-long take before it can cost anything.
  if (input.audioSeconds > MAX_DRILL_SECONDS) throw new DrillTooLongError(input.audioSeconds);

  const attemptId = input.attemptId ?? randomUUID();
  const { monthlyBudgetUsd } = readSettings(db);

  // (3) RESERVE BEFORE CALL. A refusal here means no request is made at all.
  const reservation = openPronunciationLease(db, attemptId, input.audioSeconds, monthlyBudgetUsd);
  if (!reservation) throw new BudgetExceededError();

  const audio = await readFile(input.audioPath);

  let result;
  try {
    result = await scorer.score({
      referenceText: input.drill.referenceText,
      audio,
      seconds: input.audioSeconds,
    });
  } catch (err) {
    if (err instanceof PronunciationParseError) {
      // Answered and charged, but unreadable: COMMIT the spend, store no score.
      finalizePronunciationLease(db, attemptId, input.audioSeconds);
    } else {
      // No response, no charge.
      releasePronunciationLease(db, attemptId);
    }
    throw err;
  }

  const thresholds = pronunciationThresholds();
  const lowSnr = isTooNoisy(result.snrDb, thresholds);

  // (4) Finalize the charge and store the attempt atomically — a scored take is never
  // recorded without its charge, nor charged without being recorded.
  const costUsd = db.transaction((): number => {
    const committed = finalizePronunciationLease(db, attemptId, input.audioSeconds);
    insertAttempt(db, {
      id: attemptId,
      drillKey: input.drill.drillKey,
      findingId: input.drill.findingId,
      referenceText: input.drill.referenceText,
      audioPath: input.audioPath,
      audioSeconds: input.audioSeconds,
      result,
      lowSnr,
      scorerId: scorer.id,
      costUsd: committed,
    });
    return committed;
  })();
  void costUsd;

  // Knowledge writes are deliberately OUTSIDE the money transaction: they are a
  // consequence of a stored attempt, and a derive failure must never unwind a charge
  // that really happened.
  const { seeded, credited } = applyAttemptToKnowledge(db, attemptId, result, thresholds);

  return { attempt: getAttempt(db, attemptId)!, seeded, credited };
}

/** The price the studio quotes before a take, from the same function that reserves it
 *  — a modeled estimate from `rates.ts`, never an invoiced figure (T1 still owed). */
export function drillEstimateUsd(seconds: number): number {
  return estimatePronunciationUsd(seconds);
}
