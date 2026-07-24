import type { Db } from "../db";
import { TTS_MODEL, ttsCallCost } from "../analysis/rates";
import { registerTtsInstruction, coerceRegister, type Register } from "../register";
import { phraseRenderPath } from "../audio-storage";
import { billedSynthesize } from "./engine";
import {
  getPhraseRender,
  insertPhraseRender,
  deletePhraseRender,
  phraseHash,
  type PhraseRender,
} from "./phrase-renders";
import type { TtsModelClient } from "./tts-model";

// E-33: render an arbitrary CORRECT Italian phrase to cached audio for the shadow
// and reading formats, through the ONE E-21 biller (lib/render/engine.ts —
// reserve-before-call, one ledger row, finalize-to-actual, hard cap). This is the
// phrase-keyed twin of `renderCorrection`: the ONLY differences are the cache/lease
// table (phrase_renders, keyed by content hash) and the cost key. It does NOT fork a
// second money path (WO criterion 4) — `billedSynthesize` is shared verbatim.
//
// The caller is responsible for the phrase being a CORRECT form (a finding's recast,
// a lesson example, or a canon passage) — D-18: the shadow target is never the
// learner's error. This layer just renders whatever correct text it is handed.

export interface PhraseRenderOutcome {
  render: PhraseRender;
  /** True when this call generated the clip; false when it was already cached. */
  generated: boolean;
}

/** Worst-case USD to render `text` (input characters × the TTS rate) — the SAME upper
 *  bound the cap checks before the real call. */
export function phraseRenderEstimateUsd(text: string): number {
  return ttsCallCost(TTS_MODEL, text.length);
}

/**
 * Render a correct phrase to a cached audio clip, or return the existing one.
 *
 *   * Cache hit / lost claim: return it, `generated: false`. ZERO model calls, ZERO
 *     ledger rows — replay is free (WO criterion 2).
 *   * Budget cap reached: release the claim, throw `BudgetExceededError` BEFORE any
 *     call. No call, no ledger row, no surviving cache row.
 *   * Otherwise: synthesize once with the register-aware TTS instruction (D-23),
 *     record the spend, write the file.
 *
 * Ordering is LEASE-BEFORE-SPEND: the `hash` row is claimed FIRST, so exactly one
 * racing render reaches the provider and bills; the loser makes no call and no row.
 */
export async function renderPhrase(
  db: Db,
  client: TtsModelClient,
  input: { text: string; register: Register },
): Promise<PhraseRenderOutcome> {
  const register = coerceRegister(input.register);
  const text = input.text;
  const hash = phraseHash(text, register);

  const cached = getPhraseRender(db, hash);
  if (cached) return { render: cached, generated: false };

  const costUsd = phraseRenderEstimateUsd(text);
  const path = phraseRenderPath(hash);

  // LEASE FIRST: claim the hash row before the budget check and the call.
  const won = insertPhraseRender(db, { hash, text, register, path, costUsd });
  if (!won) {
    return { render: getPhraseRender(db, hash)!, generated: false };
  }

  try {
    await billedSynthesize(db, client, {
      text,
      instructions: registerTtsInstruction(register),
      contentHash: `phrase:${hash}`,
      costUsd,
      path,
    });
  } catch (err) {
    // Budget refusal or a failed synthesize: neither committed. Release the claim so
    // a legitimate retry can re-lease and render.
    deletePhraseRender(db, hash);
    throw err;
  }

  return { render: getPhraseRender(db, hash)!, generated: true };
}
