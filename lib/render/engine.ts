import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { readSettings } from "../settings";
import { reserveSpend, finalizeReservation, releaseReservation } from "../analysis/budget";
import { TTS_MODEL, ttsCallCost } from "../analysis/rates";
import { BudgetExceededError } from "../lessons/billing";
import { registerTtsInstruction, coerceRegister } from "../register";
import { ensureRenditionsDir, renditionPath } from "../audio-storage";
import { getRendition, insertRendition, deleteRendition, type Rendition } from "./renditions";
import type { TtsModelClient } from "./tts-model";

// The render-once engine for E-21 contrastive playback (D-10), generalized by E-33
// so a SECOND format family (listen-and-shadow, reading/listening) can render an
// arbitrary CORRECT phrase through the SAME money path — reserve-before-call, one
// ledger row per render, replay bills ZERO, cap hard cross-biller. The shared
// `billedSynthesize` below IS that one biller (WO criterion 4: do NOT fork a second
// money path); `renderCorrection` here and `renderPhrase` (lib/render/phrase.ts)
// both drive it, differing only in their cache/lease table and cost key.
//
// Money-path invariant (mfactory D-15, never-waivable): recorded spend must equal
// actual spend even under concurrent Generate. So both engines LEASE BEFORE THEY
// SPEND — they claim the cache row first, before the budget check and the provider
// call. Only the request that wins the claim may call the provider; racing losers
// detect the claim and return WITHOUT a second call and WITHOUT a second ledger row.
// A claim that never bills (budget refusal or a failed synthesize) is released, so it
// is a lease and not a permanent tombstone.

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
 * The ONE TTS biller (WO criterion 4). Given a lease the CALLER has already claimed,
 * this reserves the cost as a pending ledger row (atomically, committed + pending ≤
 * cap), synthesizes once, finalizes the reservation to the actual charge, and writes
 * the audio file. It does NOT own the lease — the caller claims and releases the
 * cache row — so the same biller serves the finding-keyed and phrase-keyed caches
 * identically. Throws `BudgetExceededError` BEFORE any call when the cap refuses the
 * reservation (no call, no surviving ledger row); on a failed synthesize it releases
 * the reservation (nothing billed) and rethrows. Ordering: reserve → synthesize →
 * finalize → write. Money that left the provider is always ledgered before the file
 * write, and playback is orphan-safe if the write fails.
 */
export async function billedSynthesize(
  db: Db,
  client: TtsModelClient,
  input: { text: string; instructions?: string; contentHash: string; costUsd: number; path: string },
): Promise<void> {
  const { monthlyBudgetUsd } = readSettings(db);
  const reservation = reserveSpend(
    db,
    { model: TTS_MODEL, contentHash: input.contentHash, costUsd: input.costUsd },
    monthlyBudgetUsd,
  );
  if (!reservation) throw new BudgetExceededError();

  let result;
  try {
    result = await client.synthesize({ text: input.text, instructions: input.instructions });
  } catch (err) {
    // Nothing was billed: release the reservation (frees the cap) and rethrow. The
    // caller releases its own lease claim.
    releaseReservation(db, reservation);
    throw err;
  }

  // The provider was charged. From here the spend MUST be committed — the TTS cost is
  // known up front (estimate == actual), so finalize at the reserved cost.
  finalizeReservation(db, reservation, input.costUsd);
  await mkdir(dirname(input.path), { recursive: true });
  await writeFile(input.path, result.audio); // if this fails the row+ledger stand; playback is orphan-safe
}

/**
 * Render `finding`'s correction to a cached audio clip, or return the existing one.
 * The E-21 contract, unchanged: a cache hit / lost claim makes ZERO calls and rows;
 * the budget cap refuses truthfully before any call; otherwise synthesize once,
 * record the spend, write the file. E-33 additionally passes the register dial's TTS
 * delivery instruction (D-23) so the correction voice matches the learner's register
 * — style only, and the rendition cache key is still the finding id, so this never
 * re-bills an existing rendition.
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

  // LEASE FIRST: claim the finding_id row before the budget check and the call. If we
  // lose the claim, a concurrent Generate holds it — make no call, bill nothing.
  const won = insertRendition(db, { findingId: finding.id, path, costUsd });
  if (!won) {
    return { rendition: getRendition(db, finding.id)!, generated: false };
  }

  const instructions = registerTtsInstruction(coerceRegister(readSettings(db).register));
  await ensureRenditionsDir();
  try {
    await billedSynthesize(db, client, {
      text: finding.correction,
      instructions,
      contentHash: finding.contentHash,
      costUsd,
      path,
    });
  } catch (err) {
    // Budget refusal or a failed synthesize: neither committed. Release the claim so
    // a legitimate retry can re-lease and render.
    deleteRendition(db, finding.id);
    throw err;
  }

  const rendition = getRendition(db, finding.id)!;
  return { rendition, generated: true };
}
