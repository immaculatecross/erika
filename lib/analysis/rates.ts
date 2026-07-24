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

// Per-minute audio prices (D-10, recalibrated by E-28 toward D-20's figures).
//
// D-20 (the richness dial) recalibrated the deep model against real pricing: it
// truly costs ~$0.02/audio-minute audio-in, ~$0.03/audio-minute ALL-IN with the
// text output it returns — roughly HALF the $0.06 the founding era ledgered. So
// `gpt-audio-1.5` drops 0.06 → 0.03 and the `gpt-audio` fallback 0.10 → 0.05
// (same ~½ move). The mini triages short, time-compressed audio and stays an
// order of magnitude cheaper than the deep leg it gates. These remain the single
// price knob and an explicit approximation — a real-API smoke run against actual
// `usage` is OWED once a key exists (no live key at E-28; mirrors E-4's smoke).
export const RATES: Record<ModelId, ModelRate> = {
  "gpt-audio-mini": { usdPerAudioMinute: 0.006 },
  "gpt-audio-1.5": { usdPerAudioMinute: 0.03 },
  "gpt-audio": { usdPerAudioMinute: 0.05 },
};

/**
 * Assumed fraction of triaged segments the mini flags for deep-listening, used
 * only by the pre-run estimator (the real run bills the actual flagged set).
 * Configurable via ANALYSIS_FLAG_RATE for tuning.
 *
 * E-28 LOOSENED the triage (D-20): more borderline speech reaches the deep model,
 * so this estimator companion rises 0.3 → 0.5 (~50% flagged on a day dump). It is
 * a conservative default — a tunable knob to re-tune against real `usage` (D-13),
 * paired with the loosened wording of the triage prompt (lib/analysis/audio-model.ts).
 */
export function assumedFlagRate(raw: string | undefined = process.env.ANALYSIS_FLAG_RATE): number {
  if (raw === undefined || raw === "") return 0.5;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.5;
}

/**
 * The short-capture threshold (D-20): a session whose analysed speech is ≤ this
 * many minutes SKIPS triage and is deep-listened 100% at native speed with the
 * enriched prompt — the mini's job was to save money on long day dumps, and a
 * short, deliberate recording does not need saving. Above it, the cascade runs
 * (triage → deep only on flags). Default 30 min, a conservative knob tunable via
 * DEEP_FULL_MAX_MINUTES and to re-tune against real `usage` (D-13).
 */
export function deepFullMaxMinutes(raw: string | undefined = process.env.DEEP_FULL_MAX_MINUTES): number {
  if (raw === undefined || raw === "") return 30;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30;
}

/** USD to send `durationMs` of audio to `model`, per the rates table. */
export function callCost(model: ModelId, durationMs: number): number {
  return (durationMs / 60_000) * RATES[model].usdPerAudioMinute;
}

// ---- text model (E-6 Micro-lessons) -------------------------------------
//
// Lesson generation and rewrite grading call an OpenAI *text* chat model. Text
// models bill on TOKENS (prompt + completion), not audio-minutes, so they carry
// their own rate shape and cost function — but their spend records into the SAME
// spend_ledger and counts against the SAME monthly cap as the audio cascade
// (D-10). Model id is documented here; the rates are founding-era approximations
// to recalibrate against real `usage`, exactly like the audio numbers above.

export const TEXT_MODEL = "gpt-4.1-mini" as const;
export type TextModelId = typeof TEXT_MODEL;

/** Every model that can bill into the shared ledger — audio (E-4), text (E-6),
 *  TTS (E-21), or the realtime tutor (E-34). */
export type BillableModelId = ModelId | TextModelId | TtsModelId | RealtimeModelId;

export interface TextModelRate {
  usdPerPromptToken: number;
  usdPerCompletionToken: number;
}

// ≈ $0.40 per 1M input tokens, $1.60 per 1M output tokens — a cheap, capable
// chat model, apt for short lessons and one-line rewrite grades.
export const TEXT_RATES: Record<TextModelId, TextModelRate> = {
  "gpt-4.1-mini": {
    usdPerPromptToken: 0.4 / 1_000_000,
    usdPerCompletionToken: 1.6 / 1_000_000,
  },
};

/** USD for a text call given its token usage, per the rates table. */
export function textCallCost(model: TextModelId, promptTokens: number, completionTokens: number): number {
  const r = TEXT_RATES[model];
  return promptTokens * r.usdPerPromptToken + completionTokens * r.usdPerCompletionToken;
}

/**
 * A rough upper-bound token count for a prompt string, used only to pre-check the
 * budget *before* a call (~4 chars/token, the common English heuristic). The real
 * charge is always recomputed from the API's actual `usage`; this only has to be
 * safe enough that a call which would breach the cap is refused, never billed.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---- TTS model (E-21 Contrastive playback) -------------------------------
//
// Rendering a finding's correction in the audio model's voice is a text-to-speech
// call. TTS models bill on the number of INPUT CHARACTERS synthesized (not tokens
// or audio-minutes), so they carry their own rate shape and cost function — but
// their spend records into the SAME spend_ledger and counts against the SAME
// monthly cap as the audio cascade and the text lessons (D-10). The id lives here,
// the one price knob; the founding-era rate is an approximation to recalibrate
// against real usage, exactly like the audio and text numbers above.

export const TTS_MODEL = "gpt-4o-mini-tts" as const;
export type TtsModelId = typeof TTS_MODEL;

export interface TtsModelRate {
  usdPerCharacter: number;
}

// ≈ $12 per 1M input characters — a short correction ("un problema", ~40 chars)
// costs a small fraction of a cent, rendered once and cached forever.
export const TTS_RATES: Record<TtsModelId, TtsModelRate> = {
  "gpt-4o-mini-tts": { usdPerCharacter: 12 / 1_000_000 },
};

/** USD to synthesize `charCount` characters with `model`, per the rates table. */
export function ttsCallCost(model: TtsModelId, charCount: number): number {
  return Math.max(0, charCount) * TTS_RATES[model].usdPerCharacter;
}

// ---- ask notes (E-23 Ask Erika) ------------------------------------------
//
// "Ask for more" reuses the SAME text chat model as the E-6 micro-lessons
// (TEXT_MODEL) and bills into the SAME shared spend_ledger against the SAME monthly
// cap — no new price table, only a shorter output allowance. The one ask-specific
// knob is that output-token cap, which bounds a note's worst-case pre-call cost
// (`textCallCost(ASK_MODEL, estimateTokens(prompt), ASK_MAX_OUTPUT_TOKENS)`), just
// as LESSON_MAX_OUTPUT_TOKENS bounds a lesson's. A note is a few sentences, so its
// allowance is smaller than a full lesson's.

export const ASK_MODEL = TEXT_MODEL;
/** Output-token allowance for one ask-note — bounds its worst-case pre-call cost. */
export const ASK_MAX_OUTPUT_TOKENS = 700;

// ---- realtime tutor (E-34) -----------------------------------------------
//
// The spoken tutor (E-34) runs on OpenAI's **Realtime** speech-to-speech models
// over WebRTC. These bill on AUDIO TOKENS (input + output), separately from any
// text tokens, so they carry their own rate shape — but their spend records into
// the SAME spend_ledger and counts against the SAME monthly cap as everything else
// (D-10). This is the MOST EXPENSIVE money path in the app, so the estimate and the
// lease are derived here from a single, documented per-minute approximation.
//
// VALIDATED LIVE 2026-07-24 (operator directive — do not trust the training
// cutoff): the flagship family is `gpt-realtime` (current version
// `gpt-realtime-2.1`, the DEFAULT) with a cheaper `gpt-realtime-2.1-mini`; the
// legacy `gpt-4o-realtime-preview` is not used. Flagship audio pricing ≈ $32 / 1M
// audio-input tokens ($0.40/1M cached) + $64 / 1M audio-output tokens; mini is
// cheaper. Pin the EXACT ids and prices from the account's model list at real-run;
// these are the single price knob and an explicit approximation to recalibrate
// against real `usage` once a key exists (T1 owed — no live key in the sandbox).

export const REALTIME_FLAGSHIP = "gpt-realtime-2.1" as const;
export const REALTIME_MINI = "gpt-realtime-2.1-mini" as const;
export type RealtimeModelId = typeof REALTIME_FLAGSHIP | typeof REALTIME_MINI;

/** The Settings tier switch (WO criterion 2): flagship (default) or mini. */
export const REALTIME_TIERS = ["flagship", "mini"] as const;
export type RealtimeTier = (typeof REALTIME_TIERS)[number];

export function realtimeModelForTier(tier: RealtimeTier): RealtimeModelId {
  return tier === "mini" ? REALTIME_MINI : REALTIME_FLAGSHIP;
}

export interface RealtimeModelRate {
  /** USD per audio-INPUT token (the learner's speech reaching the model). */
  usdPerAudioInputToken: number;
  /** USD per CACHED audio-input token — much cheaper; not used by the pre-call
   *  estimate (which must be an upper bound), documented for recalibration. */
  usdPerCachedAudioInputToken: number;
  /** USD per audio-OUTPUT token (the tutor's spoken reply). */
  usdPerAudioOutputToken: number;
}

// Per-token audio prices (WO). Mini is set at ~¼ of flagship — a documented
// approximation ("mini cheaper", no published figure at authoring time), to pin to
// the real account rates at real-run (D-13). Both remain the single price knob.
export const REALTIME_RATES: Record<RealtimeModelId, RealtimeModelRate> = {
  "gpt-realtime-2.1": {
    usdPerAudioInputToken: 32 / 1_000_000,
    usdPerCachedAudioInputToken: 0.4 / 1_000_000,
    usdPerAudioOutputToken: 64 / 1_000_000,
  },
  "gpt-realtime-2.1-mini": {
    usdPerAudioInputToken: 8 / 1_000_000,
    usdPerCachedAudioInputToken: 0.1 / 1_000_000,
    usdPerAudioOutputToken: 16 / 1_000_000,
  },
};

/**
 * Assumed audio-token throughput PER ELAPSED CONVERSATION MINUTE, split by
 * direction. A spoken exchange has both parties active across a minute; realtime
 * audio tokenizes at roughly 1.5k tokens per spoken minute, so a conservative,
 * upper-bound-leaning default books ~1500 input + ~1500 output tokens per elapsed
 * minute (the pre-call estimate must never UNDER-price, or the cap could be
 * overshot). A single documented knob, tunable via env, to recalibrate against real
 * `usage` (D-13, T1). This is the ONE place the per-minute realtime cost is derived.
 */
export function realtimeAudioTokensPerMinute(
  raw: string | undefined = process.env.REALTIME_TOKENS_PER_MINUTE,
): { input: number; output: number } {
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  const per = Number.isFinite(n) && n > 0 ? n : 1500;
  return { input: per, output: per };
}

/** USD per elapsed conversation minute on `model`, from the token throughput and
 *  the per-token rates — the single per-minute realtime rate the estimate/lease use. */
export function realtimePerMinuteUsd(model: RealtimeModelId): number {
  const r = REALTIME_RATES[model];
  const { input, output } = realtimeAudioTokensPerMinute();
  return input * r.usdPerAudioInputToken + output * r.usdPerAudioOutputToken;
}

/** USD to run `minutes` of conversation on `model` — the per-session estimate and
 *  the reserved lease amount (WO criterion 5). Never negative. */
export function realtimeSessionCost(model: RealtimeModelId, minutes: number): number {
  return Math.max(0, minutes) * realtimePerMinuteUsd(model);
}
