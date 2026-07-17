// The one place prices live (D-10). Editable per-model unit rates for the E-4
// cascade. Server-safe pure data — imported by the cost estimator and the spend
// ledger so an estimate and its later actual charge are computed the same way.
//
// Billing unit: **USD per audio-minute**. OpenAI's audio models bill on tokens
// (audio-input + text), but pre-run we only know segment durations, not token
// counts — so both the estimate and the recorded actual cost are derived from
// audio-minutes here, a deliberate, documented approximation. Recalibrate these
// numbers against real `usage` from a run; this module is the single knob.

export const MINI_MODEL = "gpt-audio-mini" as const;
/** Deep-listen chain: primary first, then the D-3 fallback. */
export const DEEP_MODELS = ["gpt-audio-1.5", "gpt-audio"] as const;

export type ModelId = typeof MINI_MODEL | (typeof DEEP_MODELS)[number];

export interface ModelRate {
  /** USD charged per minute of audio sent to this model. */
  usdPerAudioMinute: number;
}

// Rough founding-era figures — the mini triages short, time-compressed audio and
// is an order of magnitude cheaper than the deep models it gates (D-10).
export const RATES: Record<ModelId, ModelRate> = {
  "gpt-audio-mini": { usdPerAudioMinute: 0.006 },
  "gpt-audio-1.5": { usdPerAudioMinute: 0.06 },
  "gpt-audio": { usdPerAudioMinute: 0.1 },
};

/**
 * Assumed fraction of triaged segments the mini flags for deep-listening, used
 * only by the pre-run estimator (the real run bills the actual flagged set).
 * Configurable via ANALYSIS_FLAG_RATE for tuning.
 */
export function assumedFlagRate(raw: string | undefined = process.env.ANALYSIS_FLAG_RATE): number {
  if (raw === undefined || raw === "") return 0.3;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.3;
}

/** USD to send `durationMs` of audio to `model`, per the rates table. */
export function callCost(model: ModelId, durationMs: number): number {
  return (durationMs / 60_000) * RATES[model].usdPerAudioMinute;
}
