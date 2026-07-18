import { writeFile } from "node:fs/promises";
import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { readSettings } from "../settings";
import { recordSpend, wouldExceedBudget } from "../analysis/budget";
import { TTS_MODEL, ttsCallCost } from "../analysis/rates";
import { BudgetExceededError } from "../lessons/billing";
import { ensureRenditionsDir, renditionPath } from "../audio-storage";
import { getRendition, insertRendition, type Rendition } from "./renditions";
import type { TtsModelClient } from "./tts-model";

// The render-once engine for E-21 contrastive playback (D-10). Rendering a
// finding's correction in the audio model's voice happens at most once, ever:
// replays are pure cache hits with zero model calls and zero ledger rows, and the
// monthly budget cap refuses generation truthfully with no call and no row. Reuses
// E-4's budget spine (lib/analysis/budget.ts) and E-6's `BudgetExceededError`
// exactly — the same shared cap the analysis cascade and the text lessons obey.

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
 *   * Budget cap reached: throw `BudgetExceededError` BEFORE any model call and
 *     before any write. No call, no ledger row (criterion 2).
 *   * Otherwise: synthesize once, write the file, then commit the row and the
 *     spend in ONE transaction. The `finding_id` PK is an INSERT-first guard, so a
 *     double-clicked Generate cannot double-bill: only the transaction that wins
 *     the row records spend (criterion 1). better-sqlite3 serializes transactions,
 *     so two racing generations can never both win; the loser's identical file
 *     write (same deterministic path) is harmless and it charges nothing.
 *
 * The file is written before the row commits, so any row that exists always has its
 * file — but playback is orphan-safe regardless (the audio route 404s on a missing
 * file rather than crashing).
 */
export async function renderCorrection(
  db: Db,
  client: TtsModelClient,
  finding: Finding,
): Promise<RenderOutcome> {
  const cached = getRendition(db, finding.id);
  if (cached) return { rendition: cached, generated: false };

  const costUsd = renditionEstimateUsd(finding.correction);
  const { monthlyBudgetUsd } = readSettings(db);
  if (wouldExceedBudget(db, costUsd, monthlyBudgetUsd)) {
    throw new BudgetExceededError();
  }

  const result = await client.synthesize({ text: finding.correction });
  const path = renditionPath(finding.id);
  await ensureRenditionsDir();
  await writeFile(path, result.audio);

  // INSERT-first, spend-second, in one transaction: the row and its ledger entry
  // commit together, and only the winner of the PK records the charge.
  const won = db.transaction(() => {
    const inserted = insertRendition(db, { findingId: finding.id, path, costUsd });
    if (inserted) {
      recordSpend(db, { model: TTS_MODEL, contentHash: finding.contentHash, costUsd });
    }
    return inserted;
  })();

  const rendition = getRendition(db, finding.id)!;
  return { rendition, generated: won };
}
