// ---- drill speech-to-text (E-45) -----------------------------------------
//
// The ONLY speech-to-text in this product, and its narrowness is the point. D-3
// forbids transcribing speech to find errors, and D-28 restates why: a transcript
// erases pronunciation, hesitation and the almost-right word — the exact signal an
// advanced learner needs — and `whisper-1` was measured in spike-6 silently
// CORRECTING a learner's planted errors (`familia` → `famiglia`).
//
// What D-21 has always allowed, and D-28 confirms for E-45, is SCRIPTED assessment:
// a drill has a KNOWN CORRECT ANSWER, so transcribing the answer is comparing a
// word to a word, not diagnosing free speech. This model id is reachable from the
// drill answer route and from nowhere else; it must never be pointed at a capture,
// a tutor turn, or anything the learner said spontaneously.
//
// Billing rides the same spend_ledger under the same monthly cap, reserved before
// the call like every other biller.

export const STT_MODEL = "gpt-4o-mini-transcribe" as const;
export const TUTOR_STT_MODEL = "gpt-4o-transcribe" as const;
export type SttModelId = typeof STT_MODEL | typeof TUTOR_STT_MODEL;

export interface SttModelRate {
  usdPerAudioMinute: number;
}

/**
 * ⚠️ THE DANGEROUS DIRECTION: under-pricing makes the cap a lie; over-pricing costs
 * a slightly early refusal. So this is a deliberate FLOOR, not an estimate.
 * The published rate for `gpt-4o-mini-transcribe` is ~$0.003 per audio-minute; this
 * carries 2× headroom, and a drill answer is a few seconds, so the absolute figure
 * is a small fraction of a cent either way. Recalibrate against real invoices when
 * usage→invoice reconciliation lands (owed, STATE.md).
 */
export const STT_RATES: Record<SttModelId, SttModelRate> = {
  "gpt-4o-mini-transcribe": { usdPerAudioMinute: 0.006 },
  // Published $0.006/minute. Book 25% headroom because under-pricing is the
  // dangerous direction and the provider may bill token-shaped short turns.
  "gpt-4o-transcribe": { usdPerAudioMinute: 0.0075 },
};

/** USD to transcribe `seconds` of drill audio, per the rates table. A partial
 *  minute bills as its fraction, and the caller reserves a ceiling before calling. */
export function sttCallCost(model: SttModelId, seconds: number): number {
  return (Math.max(0, seconds) / 60) * STT_RATES[model].usdPerAudioMinute;
}
