import type { Db } from "../db";
import { readSettings } from "../settings";
import { monthToDateSpend, wouldExceedBudget } from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import type { TextCompletion, TextModelClient } from "./text-model";

// The money-safety seam shared by lesson generation and rewrite grading (E-6,
// D-10). Text calls reuse E-4's budget spine exactly: before every billable call
// we check the SAME shared monthly cap and refuse truthfully if this call would
// breach it — no call, no over-cap ledger row. The pre-call estimate is a safe
// upper bound (worst-case: the whole `maxOutputTokens` is spent), so a call that
// would breach the cap is refused, never billed. The real charge is recomputed
// from the API's actual `usage`; the caller records it (atomically with any
// persist) into the shared spend_ledger.

/** Thrown when a billable call would breach the monthly cap. Message is user-facing. */
export class BudgetExceededError extends Error {
  constructor(message = "Monthly budget reached.") {
    super(message);
  }
}

export interface BilledCall {
  completion: TextCompletion;
  /** The call's actual cost from token usage — record this into the ledger. */
  costUsd: number;
}

/**
 * Run one billable text call under the shared monthly cap. Estimates an
 * upper-bound cost from the prompt length plus the full output allowance, and
 * throws `BudgetExceededError` *before* calling if that would exceed the cap.
 * Otherwise it calls the model and returns the completion with its actual cost.
 */
export async function runBilledTextCall(
  db: Db,
  client: TextModelClient,
  input: { prompt: string; maxOutputTokens: number },
): Promise<BilledCall> {
  const { monthlyBudgetUsd } = readSettings(db);
  const estCost = textCallCost(TEXT_MODEL, estimateTokens(input.prompt), input.maxOutputTokens);
  if (wouldExceedBudget(db, estCost, monthlyBudgetUsd)) {
    throw new BudgetExceededError();
  }
  const completion = await client.complete(input);
  const costUsd = textCallCost(TEXT_MODEL, completion.promptTokens, completion.completionTokens);
  return { completion, costUsd };
}

/** True once the month's spend has already reached the cap — for route-level pre-checks. */
export function budgetReached(db: Db): boolean {
  const { monthlyBudgetUsd } = readSettings(db);
  return monthToDateSpend(db) >= monthlyBudgetUsd - 1e-9;
}
