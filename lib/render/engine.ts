import { writeFile } from "node:fs/promises";
import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { readSettings } from "../settings";
import { recordSpend, wouldExceedBudget } from "../analysis/budget";
import { TTS_MODEL, ttsCallCost } from "../analysis/rates";
import { BudgetExceededError } from "../lessons/billing";
import { ensureRenditionsDir, renditionPath } from "../audio-storage";
import { getRendition, insertRendition, deleteRendition, type Rendition } from "./renditions";
import type { TtsModelClient } from "./tts-model";

// The render-once engine for E-21 contrastive playback (D-10). Rendering a
// finding's correction in the audio model's voice happens at most once, ever:
// replays are pure cache hits with zero model calls and zero ledger rows, and the
// monthly budget cap refuses generation truthfully with no call and no row. Reuses
// E-4's budget spine (lib/analysis/budget.ts) and E-6's `BudgetExceededError`
// exactly — the same shared cap the analysis cascade and the text lessons obey.
//
// Money-path invariant (mfactory D-15, never-waivable): recorded spend must equal
// actual spend even under concurrent Generate. So this engine LEASES BEFORE IT
// SPENDS — it claims the `finding_id` row first, before the budget check and before
// the provider call, exactly as the analysis cascade claims its job lease before
// calling the model. Only the request that wins the claim may call the provider;
// racing losers detect the claim and return WITHOUT a second call and WITHOUT a
// second ledger row. A claim that never bills (budget refusal or a failed
// synthesize) is released, so it is a lease and not a permanent tombstone.

export { BudgetExceededError } from "../lessons/billing";

export interface RenderOutcome {
  rendition: Rendition;
  /** True when this call generated the clip; false when it was already cached. */
  generated: boolean;
}

/** Worst-case USD to render this correction, per the existing rates machinery. */
export function renditionEstimateUsd(correction: string): number {
  return ttsCallCost(TTS_MODEL, correction.length);
}

/**
 * Render `finding`'s correction to a cached audio clip, or return the existing one.
 *
 *   * Cache hit (a rendition already exists): return it, `generated: false`. ZERO
 *     model calls, ZERO ledger rows — this is what makes replay free (criterion 1).
 *   * Claim lost (a concurrent Generate holds the lease): return the in-progress
 *     rendition, `generated: false`. ZERO model calls, ZERO ledger rows — the loser
 *     of the race NEVER makes a provider call (the money-path invariant, D-15).
 *   * Budget cap reached: release the claim, then throw `BudgetExceededError`
 *     BEFORE any model call. No call, no ledger row, no surviving row (criterion 2).
 *   * Otherwise: synthesize once, record the spend, write the file.
 *
 * Ordering is LEASE-BEFORE-SPEND: the `finding_id` PK row is claimed via
 * `insertRendition` FIRST — before the budget check and before `synthesize()`. The
 * claim is exclusive (PK + serialized statements), so exactly one request reaches
 * the provider; every racing request that fails the claim returns without a call
 * and without a charge. Because the cost is fully determined from the correction
 * length (estimate == actual), the claim row already carries its final cost; only
 * the spend record and the file write remain after a successful call. If the call
 * or the budget check does not go through, the claim is released (`deleteRendition`)
 * so it never permanently blocks a legitimate retry. `recordSpend` runs immediately
 * after a successful `synthesize()` — money that left the provider is always
 * ledgered — then the file is written; playback is orphan-safe regardless (the
 * audio route 404s on a missing file rather than crashing).
 */
export async function renderCorrection(
  db: Db,
  client: TtsModelClient,
  finding: Finding,
): Promise<RenderOutcome> {
  const cached = getRendition(db, finding.id);
  if (cached) return { rendition: cached, generated: false };

  const costUsd = renditionEstimateUsd(finding.correction);
  const path = renditionPath(finding.id);

  // LEASE FIRST: claim the finding_id row before the budget check and before the
  // provider call. If we lose the claim, a concurrent Generate already holds it —
  // make no call and bill nothing; hand back its in-progress rendition.
  const won = insertRendition(db, { findingId: finding.id, path, costUsd });
  if (!won) {
    return { rendition: getRendition(db, finding.id)!, generated: false };
  }

  let result;
  try {
    const { monthlyBudgetUsd } = readSettings(db);
    if (wouldExceedBudget(db, costUsd, monthlyBudgetUsd)) {
      throw new BudgetExceededError();
    }
    result = await client.synthesize({ text: finding.correction });
  } catch (err) {
    // Budget refusal or a failed synthesize — NOTHING has been billed yet: release
    // the claim so a legitimate retry can re-lease and render.
    deleteRendition(db, finding.id);
    throw err;
  }

  // The provider was charged. From here the claim MUST stand and the spend MUST be
  // recorded — never release the row past this point, or a retry would re-bill.
  recordSpend(db, { model: TTS_MODEL, contentHash: finding.contentHash, costUsd });
  await ensureRenditionsDir();
  await writeFile(path, result.audio); // if this fails the row+ledger stay; playback is orphan-safe

  const rendition = getRendition(db, finding.id)!;
  return { rendition, generated: true };
}
