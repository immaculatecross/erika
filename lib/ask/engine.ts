import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { readSettings } from "../settings";
import { recordSpend, wouldExceedBudget } from "../analysis/budget";
import { collectSpeakerProfile } from "../analysis/profile";
import { ASK_MODEL, ASK_MAX_OUTPUT_TOKENS, textCallCost } from "../analysis/rates";
import { BudgetExceededError } from "../lessons/billing";
import type { TextModelClient } from "../lessons/text-model";
import { askPrompt, askEstimateUsd, parseAskResponse, selectCandidates } from "./note-builder";
import { claimNote, completeNote, deleteNote, getCompletedNote, type AskNote } from "./notes";

// The ask-once engine for E-23 "Ask Erika" (the v0.3 finale). Asking a finding for
// a deeper note calls the text model at most once, ever: re-opening the note is a
// pure cache hit with zero model calls and zero ledger rows, and the monthly budget
// cap refuses generation truthfully with no call and no row. Reuses E-4's budget
// spine (lib/analysis/budget.ts), E-6's `BudgetExceededError` and text-model seam,
// and E-19's speaker profile — the same shared cap the analysis cascade, the text
// lessons, and the render engine obey.
//
// Money-path invariant (mfactory D-15, never-waivable): recorded spend must equal
// actual spend even under concurrent Ask. So this engine LEASES BEFORE IT SPENDS —
// it claims the `finding_id` row FIRST, before the budget check and before the model
// call, exactly as lib/render/engine.ts claims its rendition lease. Only the request
// that wins the claim may call the provider; racing losers detect the claim and
// return WITHOUT a second call and WITHOUT a second ledger row. A claim that never
// bills (budget refusal or a failed/unreadable call) is released, so it is a lease
// and not a permanent tombstone. A finding's note structurally cites ≥1 OTHER
// finding from the user's own corpus (note-builder.ts guarantees it), so the milestone
// never persists an "ask" that stands alone.

export { BudgetExceededError } from "../lessons/billing";

/** Thrown when a finding has no OTHER corpus finding to cite — ask is impossible. */
export class NoCorpusToCiteError extends Error {
  constructor(message = "Ask needs at least one other finding to relate this to.") {
    super(message);
  }
}

export interface AskOutcome {
  /** The completed note, or null for a racing loser whose winner is still in flight. */
  note: AskNote | null;
  /** True when THIS call generated the note; false when it was cached or lost the race. */
  generated: boolean;
}

/** Whether an ask is possible for this finding (there is ≥1 other finding to cite). */
export function canAsk(db: Db, finding: Finding): boolean {
  return selectCandidates(db, finding).length > 0;
}

/** Worst-case USD to generate this finding's note, from the same prompt the call uses. */
export function estimateUsd(db: Db, finding: Finding): number {
  const candidates = selectCandidates(db, finding);
  const { targetLanguage } = readSettings(db);
  return askEstimateUsd(askPrompt(targetLanguage, finding, candidates, collectSpeakerProfile(db)));
}

/**
 * Generate `finding`'s deeper note, or return the existing one.
 *
 *   * Cache hit (a completed note exists): return it, `generated: false`. ZERO
 *     model calls, ZERO ledger rows — this is what makes re-opening free.
 *   * No other finding to cite: throw `NoCorpusToCiteError` BEFORE any claim or
 *     spend — a note that cites nothing is not a thing this milestone ships.
 *   * Claim lost (a concurrent Ask holds the lease): return `{ note, generated:
 *     false }` — the completed note if the winner already finished, else null.
 *     ZERO model calls, ZERO ledger rows — the loser NEVER calls the provider (D-15).
 *   * Budget cap reached: release the claim, then throw `BudgetExceededError`
 *     BEFORE any model call. No call, no ledger row, no surviving row.
 *   * Otherwise: call once, record the spend, complete the note.
 *
 * Ordering is LEASE-BEFORE-SPEND: `claimNote` inserts the `finding_id` PK row FIRST
 * — before the budget check and before `client.complete()`. The claim is exclusive
 * (PK + serialized statements), so exactly one request reaches the provider; every
 * racing request that fails the claim returns without a call and without a charge.
 * Unlike a rendition (whose cost is known up front), a note's text and cost are only
 * known after the call, so the claim starts EMPTY and is completed by `completeNote`
 * once the reply parses. Every handled failure before completion releases the claim
 * (`deleteNote`). Once the provider has been charged the money is ALWAYS ledgered —
 * even an unreadable reply records its spend (E-16 defect 4) before releasing — so a
 * retry re-bills only a genuinely new call, never a phantom one.
 */
export async function askFinding(
  db: Db,
  client: TextModelClient,
  finding: Finding,
): Promise<AskOutcome> {
  const cached = getCompletedNote(db, finding.id);
  if (cached) return { note: cached, generated: false };

  const candidates = selectCandidates(db, finding);
  if (candidates.length === 0) throw new NoCorpusToCiteError();

  const { targetLanguage, monthlyBudgetUsd } = readSettings(db);
  const prompt = askPrompt(targetLanguage, finding, candidates, collectSpeakerProfile(db));
  const estCost = askEstimateUsd(prompt);

  // LEASE FIRST: claim the finding_id row before the budget check and before the
  // model call. If we lose the claim, a concurrent Ask already holds it — make no
  // call and bill nothing; hand back the completed note if it is ready yet.
  const won = claimNote(db, { findingId: finding.id, costUsd: estCost });
  if (!won) return { note: getCompletedNote(db, finding.id), generated: false };

  let completion;
  try {
    if (wouldExceedBudget(db, estCost, monthlyBudgetUsd)) throw new BudgetExceededError();
    completion = await client.complete({ prompt, maxOutputTokens: ASK_MAX_OUTPUT_TOKENS });
  } catch (err) {
    // Budget refusal or a failed call — NOTHING has been billed yet: release the
    // claim so a legitimate retry can re-lease and generate.
    deleteNote(db, finding.id);
    throw err;
  }

  // The provider was charged. From here the money MUST be ledgered. Recompute the
  // actual cost from the reply's token usage.
  const costUsd = textCallCost(ASK_MODEL, completion.promptTokens, completion.completionTokens);
  let parsed;
  try {
    parsed = parseAskResponse(completion.text, candidates);
  } catch (err) {
    // Billed but unreadable: ledger the charge (never understate spend) THEN release
    // the empty claim so no half-note persists. A retry is a new, separately-billed call.
    recordSpend(db, { model: ASK_MODEL, contentHash: finding.id, costUsd });
    deleteNote(db, finding.id);
    throw err;
  }

  // Complete the note and record its spend in ONE transaction — a note is never
  // stored without its charge, nor charged without being stored.
  const note = db.transaction(() => {
    recordSpend(db, { model: ASK_MODEL, contentHash: finding.id, costUsd });
    return completeNote(db, {
      findingId: finding.id,
      note: parsed.note,
      citedIds: parsed.citedIds,
      costUsd,
    });
  })();
  return { note, generated: true };
}
