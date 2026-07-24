import type { Db } from "../db";
import { ModelParseError } from "./audio-model";
import {
  reserveSpend,
  releaseReservation,
  finalizeReservation,
  type SpendReservation,
} from "./budget";
import type { BillableModelId } from "./rates";

// The reserve-before-call money spine of the cascade (E-27), factored out of
// lib/analysis/cascade.ts to keep that file under the 500-line hook. Every billable
// cascade call goes through here: it reserves the estimated cost as a PENDING ledger
// row atomically (committed + pending ≤ cap) before firing, so the whole concurrency
// pool can race without ever overshooting the cap, and settles the reservation by
// outcome. The caller finalizes the winning (still-pending) reservation inside the
// findings + witness transaction (E-4 c5), so a resolved call's charge commits
// exactly once with its completion record.

/** Internal signal: month-to-date + this call would breach the budget cap. The run
 *  catches it and lands `halted` (findings so far kept, cap never exceeded). */
export class BudgetHalt extends Error {}

/** A resolved successful call, plus the still-pending reservation the caller must
 *  finalize atomically with the findings + witness (E-4 criterion 5). */
export interface ReservedResult<T> {
  result: T;
  reservation: SpendReservation;
}

/**
 * Reserve one billable call's estimated cost, make the call, and settle the
 * reservation by outcome (E-27 criteria 2 & 5).
 *
 * Reserve-before-call is what keeps the cap hard with the whole pool racing: the
 * reservation is a *pending* ledger row inserted atomically only if committed +
 * pending + this cost stays within the budget, so two racers can never both pass
 * and overshoot. If the cap refuses the reservation, no call is made — a BudgetHalt.
 *
 * On the call resolving:
 *   * SUCCESS — the reservation is returned still pending; the caller finalizes it
 *     inside the findings+witness transaction, so the charge commits exactly once
 *     with the completion record.
 *   * `ModelParseError` — OpenAI answered and CHARGED but the body was unreadable;
 *     the reservation is FINALIZED to its charged cost right here (never released):
 *     a parse-failed reply still bills (E-16 defect 4).
 *   * anything else (`ModelUnavailableError` / network — no completion, no charge)
 *     — the reservation is RELEASED, committing nothing.
 */
export async function reservedCall<T>(
  db: Db,
  model: BillableModelId,
  contentHash: string,
  costUsd: number,
  budget: number,
  call: (opts: { strictJson: boolean }) => Promise<T>,
  strictJson: boolean,
): Promise<ReservedResult<T>> {
  const reservation = reserveSpend(db, { model, contentHash, costUsd }, budget);
  if (!reservation) throw new BudgetHalt();
  try {
    const result = await call({ strictJson });
    return { result, reservation }; // pending — the caller finalizes it with the witness
  } catch (err) {
    if (err instanceof ModelParseError) {
      // Resolved and charged; commit the reservation as its charged cost, then rethrow
      // so the caller's repair/unreadable handling runs (E-16 defect 4). No findings
      // and no witness ride with it — `markUnreadable` writes those separately.
      finalizeReservation(db, reservation);
    } else {
      releaseReservation(db, reservation); // no completion, no charge
    }
    throw err;
  }
}

/**
 * Make one billable model call, and on an unreadable reply make EXACTLY one more
 * with the stricter JSON-only instruction (E-16b criterion 4).
 *
 * Each attempt reserves before it fires (the cap counts committed + pending), so no
 * attempt is ever made over the cap, and each attempt that RESOLVED-but-unreadable
 * bills exactly once (E-16 defect 4). On success the winning reservation is returned
 * pending for the caller to finalize with the findings+witness. Exactly one retry:
 * enough to recover the common case (a reply wrapped in prose or a fence), bounded so
 * a model stuck in a bad mode cannot spend the budget arguing with itself; a
 * truncation is retried too, since the stricter instruction also asks for less.
 */
export async function withRepair<T>(
  db: Db,
  model: BillableModelId,
  contentHash: string,
  costUsd: number,
  budget: number,
  call: (opts: { strictJson: boolean }) => Promise<T>,
): Promise<ReservedResult<T>> {
  try {
    return await reservedCall(db, model, contentHash, costUsd, budget, call, false);
  } catch (err) {
    if (!(err instanceof ModelParseError)) throw err;
    return reservedCall(db, model, contentHash, costUsd, budget, call, true);
  }
}
