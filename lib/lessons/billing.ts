import type { Db } from "../db";
import { readSettings } from "../settings";
import {
  monthToDateSpend,
  reserveSpend,
  finalizeReservation,
  releaseReservation,
  type SpendReservation,
} from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import type { TextCompletion, TextModelClient } from "./text-model";

// The money-safety seam shared by lesson generation and rewrite grading (E-6,
// D-10). Text calls reuse E-4's budget spine — now via reserve-before-call (E-28
// criterion 5b): before every billable call we RESERVE the worst-case cost as a
// PENDING ledger row atomically (committed + pending ≤ cap) and refuse truthfully if
// that would breach the cap — no call, no surviving row. The reservation makes this
// biller's in-flight spend visible to the concurrency-pool cascade, so neither can
// commit on top of the other and overshoot the cap. The pre-call estimate is a safe
// upper bound (worst-case: the whole `maxOutputTokens` is spent); the real charge,
// recomputed from the API's actual `usage`, is ≤ it, so finalizing to the actual can
// never raise committed spend above what the cap already admitted. The caller
// finalizes the reservation (atomically with any persist) into the shared ledger.

/** Thrown when a billable call would breach the monthly cap. Message is user-facing. */
export class BudgetExceededError extends Error {
  constructor(message = "Monthly budget reached.") {
    super(message);
  }
}

export interface BilledCall {
  completion: TextCompletion;
  /** The call's actual cost from token usage — finalize the reservation to this. */
  costUsd: number;
  /** The pending reservation the caller must finalize (on success/parse-fail) — the
   *  charge that is already counted against the cap, committed exactly once. */
  reservation: SpendReservation;
}

/**
 * Run one billable text call under the shared monthly cap via reserve-before-call.
 * Reserves an upper-bound cost (prompt length + the full output allowance) as a
 * pending row and throws `BudgetExceededError` *before* calling if the cap refuses
 * it. Otherwise it calls the model and returns the completion, its actual cost, and
 * the still-pending reservation. A failed call (nothing billed) releases the
 * reservation before rethrowing.
 */
export async function runBilledTextCall(
  db: Db,
  client: TextModelClient,
  input: { prompt: string; maxOutputTokens: number; contentHash: string },
): Promise<BilledCall> {
  const { monthlyBudgetUsd } = readSettings(db);
  const estCost = textCallCost(TEXT_MODEL, estimateTokens(input.prompt), input.maxOutputTokens);
  const reservation = reserveSpend(db, { model: TEXT_MODEL, contentHash: input.contentHash, costUsd: estCost }, monthlyBudgetUsd);
  if (!reservation) throw new BudgetExceededError();
  let completion: TextCompletion;
  try {
    completion = await client.complete(input);
  } catch (err) {
    releaseReservation(db, reservation); // no completion, no charge
    throw err;
  }
  const costUsd = textCallCost(TEXT_MODEL, completion.promptTokens, completion.completionTokens);
  return { completion, costUsd, reservation };
}

/**
 * Parse a resolved billable call's response, FINALIZING the reservation to the
 * actual charge if the parse fails (E-16 defect 4). The call already completed, so
 * OpenAI already charged; committing nothing on a malformed reply let the retry bill
 * again while the "hard cap" capped only *committed* money — it understated spend
 * precisely when things were going wrong. On success nothing is written here: the
 * caller finalizes the reservation itself, so `generateLessonForPattern` keeps
 * committing the lesson and its charge in ONE transaction.
 */
export function parseBilledResponse<T>(
  db: Db,
  billed: { reservation: SpendReservation; costUsd: number },
  parse: () => T,
): T {
  try {
    return parse();
  } catch (err) {
    finalizeReservation(db, billed.reservation, billed.costUsd);
    throw err;
  }
}

/** True once the month's spend has already reached the cap — for route-level pre-checks. */
export function budgetReached(db: Db): boolean {
  const { monthlyBudgetUsd } = readSettings(db);
  return monthToDateSpend(db) >= monthlyBudgetUsd - 1e-9;
}
