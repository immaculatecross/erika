// The one place prices live (D-10). Editable per-model unit rates for the E-4
// cascade. Server-safe pure data — imported by the cost estimator and the spend
// ledger so an estimate and its later actual charge are computed the same way.
//
// Billing unit: **USD per audio-minute**. OpenAI's audio models bill on tokens
// (audio-input + text), but pre-run we only know segment durations, not token
// counts — so both the estimate and the recorded actual cost are derived from
// audio-minutes here, a deliberate, documented approximation. Recalibrate these
// numbers against real `usage` from a run; this module is the single knob.

import type { RealtimeModelId } from "./rates-realtime";

// Drill speech-to-text lives in ./stt-rates (500-line hook) and is re-exported
// here, so `lib/analysis/rates.ts` remains the one place prices are looked up.
import type { SttModelId } from "./stt-rates";
export { STT_MODEL, STT_RATES, sttCallCost, type SttModelId, type SttModelRate } from "./stt-rates";

export const MINI_MODEL = "gpt-audio-mini" as const;
/** Deep-listen chain: primary first, then the D-3 fallback. */
export const DEEP_MODELS = ["gpt-audio-1.5", "gpt-audio"] as const;

export type ModelId = typeof MINI_MODEL | (typeof DEEP_MODELS)[number];

export interface ModelRate {
  /** USD per audio-INPUT token — the published per-token price. */
  usdPerAudioInputToken: number;
  /** USD per TEXT prompt token. Was priced at $0; see the note below. */
  usdPerPromptToken: number;
  /** USD per TEXT completion token. Was priced at $0; see the note below. */
  usdPerCompletionToken: number;
  /**
   * Modelled TEXT PROMPT tokens this model is sent per call — a FLOOR over the real
   * prompt, pinned by `tests/rates-text-floor.test.ts` against the actual prompt
   * builders plus the hard-capped speaker profile. Grow the prompt and that test
   * goes red rather than the cap going quietly wrong.
   */
  promptTokens: number;
  /**
   * Modelled TEXT COMPLETION tokens per call. Below the ceiling the code actually
   * enforces (`DEEP_MAX_OUTPUT_TOKENS` / `TRIAGE_MAX_OUTPUT_TOKENS`) and above the
   * replies we expect, so it over-books without pricing every call at a worst case
   * that almost never occurs.
   */
  completionTokens: number;
}

/**
 * Assumed audio tokens per minute of audio, the bridge between the published
 * per-token audio price and the per-minute figure the estimator and the ledger use.
 *
 * **MEASURED, not inferred** (`docs/research/spike-6-tutor-listening.md` §5.4): real
 * `usage` across 10 clips of 3.45–33.80 s gives **10.47 audio-input tokens/second =
 * 628 per audio-minute**, spread **505–665**. That is the first figure in this repo
 * taken from a live account rather than from secondary sources, and it discharges
 * part of the standing reconciliation this file has always owed.
 *
 * This books **700** — above the measured MAXIMUM of the spread, not merely above
 * its mean — because over-booking is the only safe direction here (see the asymmetry
 * note below) and because a floor that clears the average still under-prices every
 * call in the upper half of the distribution.
 */
export const AUDIO_TOKENS_PER_MINUTE = 700;

// ⚠️ THE ERROR DIRECTIONS ARE NOT SYMMETRIC — read before editing a number down.
// These rates drive the pre-call estimate and the reserved lease, which is what the
// hard monthly cap is enforced against. So:
//
//   * OVER-estimating a rate costs the user a slightly EARLY refusal — the cap bites
//     a little sooner than it strictly had to. Annoying; harmless.
//   * UNDER-estimating a rate makes the cap a LIE — the modelled budget believes it
//     has headroom the invoice will not honour, so real spend can exceed the cap the
//     user set. Under-pricing is the ONE direction that can overshoot.
//
// [E-42 criterion 13] TEXT WAS PRICED AT $0, AND THAT MATTERS MORE NOW THAN EVER.
// Until this milestone a call's cost was `audioMinutes × usdPerAudioMinute` and
// nothing else — an audio-input floor with no allowance for the prompt going up or
// the JSON coming back. On the most-used money path that was never harmless, and
// E-39 made it worse: the deep prompt grew from ~1,900 to 7,392 characters
// (≈1,848 tokens) when it absorbed `lib/mistakes.ts`, and every one of those tokens
// is re-sent on EVERY deep call. On a day dump with ~70 deep calls that is ~129k
// prompt tokens the model was billing us for and the ledger recorded as free. And
// this milestone makes analysis AUTOMATIC — nobody presses anything — so the error
// now compounds on every recording without a human ever deciding to spend.
//
// So the table is rebuilt on the PUBLISHED PER-TOKEN PRICES rather than on a single
// conflated per-minute figure that silently carried "some text allowance":
//
//   gpt-audio-1.5   audio in $32/1M · text $2.50/1M in · $10/1M out
//   gpt-audio       audio in $32/1M · text $2.50/1M in · $10/1M out
//   gpt-audio-mini  audio in $10/1M · text $0.60/1M in · $2.40/1M out
//
// CROSS-CHECKED AGAINST THIS REPO'S OWN RESEARCH BEFORE BEING WRITTEN, because twice
// now a constant here has contradicted a figure `docs/research/` already recorded
// correctly with citations: `docs/research/spike-1-speaker-throughput.md` §pricing
// and `docs/research/spike-3-extraction-tutor.md` §table both carry exactly these
// rows, and both put audio input at ~600 tokens/minute.
//
// What this changes in practice: the fixed per-call text cost is now charged even to
// a very short segment (previously such a segment was billed almost nothing however
// large the prompt), while a long segment's per-minute figure drops toward its true
// audio-input price. Both moves make the model match the invoice's shape.
//
// ⚠️ AND THE PART THAT IS EASY TO STATE WRONGLY. Against the OLD per-minute-only
// table the new total is NOT uniformly higher — it is higher for short calls and
// lower for long ones, crossing over at:
//
//   gpt-audio-1.5   ~3.49 audio-minutes   (old $0.030/min vs new $0.0224/min + $0.0265/call)
//   gpt-audio       ~0.96 audio-minutes   (old $0.050/min vs new $0.0224/min + $0.0265/call)
//   gpt-audio-mini  never — its per-minute rate ROSE, so it is higher at every length
//
// The property that matters is not "higher than before" but "at or above MEASURED
// reality", which is a different claim and the only one worth defending. It holds at
// every duration and is enforced, not asserted: `tests/rates-text-floor.test.ts`
// checks each model against spike-6's measured 5.15 s turn and 10-minute segment and
// sweeps nine durations from 1 s to 30 min. This repo has been bitten specifically by
// prose asserting a money property no test enforced — so the prose defers to the test.
//
// The all-in figures sit above D-20's modelled $0.22 per 10-min capture and $1.77 per
// 12-h dump, deliberately: D-20's numbers were computed before the prompt quadrupled.
// The standing usage→invoice reconciliation ([RETRO-002 T1]) is still what should
// eventually replace every estimate here with a measurement; the cap guards the
// MODELLED budget, not the invoice.
export const RATES: Record<ModelId, ModelRate> = {
  "gpt-audio-mini": {
    usdPerAudioInputToken: 10 / 1_000_000,
    usdPerPromptToken: 0.6 / 1_000_000,
    usdPerCompletionToken: 2.4 / 1_000_000,
    // `triagePrompt` is 578 chars (~145 tokens) plus the profile block, which is
    // hard-capped at PROFILE_MAX_CHARS (1200 chars, ~300 tokens). 600 clears both.
    promptTokens: 600,
    // Triage answers one boolean and a short reason; TRIAGE_MAX_OUTPUT_TOKENS caps
    // it at 400, so booking the whole ceiling costs a fraction of a cent and is a
    // genuine upper bound rather than a guess.
    completionTokens: 400,
  },
  "gpt-audio-1.5": {
    usdPerAudioInputToken: 32 / 1_000_000,
    usdPerPromptToken: 2.5 / 1_000_000,
    usdPerCompletionToken: 10 / 1_000_000,
    // `deepPrompt` is 7,392 chars (~1,848 tokens) plus the ≤1,200-char profile block
    // and the recurrence instruction. 2,600 clears the worst case with headroom.
    promptTokens: 2600,
    // DEEP_MAX_OUTPUT_TOKENS is 4,000, deliberately far above a real reply so the
    // truncation repair stays rare. Booking the full ceiling would roughly double a
    // day dump's modelled cost against replies that never approach it, so this books
    // an over-estimate of the observed band instead — but the band is now MEASURED,
    // not guessed: spike-6's live 10-minute analysis figure ($0.0219/audio-min)
    // implies ~1,240 output tokens for a real segment. 1,200 sat just BELOW that, so
    // the output leg alone was under-priced; 2,000 clears it by ~60% and is still
    // half the enforced ceiling.
    completionTokens: 2000,
  },
  "gpt-audio": {
    usdPerAudioInputToken: 32 / 1_000_000,
    usdPerPromptToken: 2.5 / 1_000_000,
    usdPerCompletionToken: 10 / 1_000_000,
    promptTokens: 2600,
    completionTokens: 2000,
  },
};

/** USD per minute of audio sent to `model` — audio input only, derived from the
 *  published per-token price. The per-call TEXT cost is added by `callCost`. */
export function usdPerAudioMinute(model: ModelId): number {
  return AUDIO_TOKENS_PER_MINUTE * RATES[model].usdPerAudioInputToken;
}

/** USD of TEXT a single call to `model` costs — prompt in, JSON out. Fixed per
 *  call, because the prompt is re-sent in full every time (criterion 13). */
export function textCallOverhead(model: ModelId): number {
  const r = RATES[model];
  return r.promptTokens * r.usdPerPromptToken + r.completionTokens * r.usdPerCompletionToken;
}

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

/**
 * USD for ONE call to `model` carrying `durationMs` of audio: the audio input, plus
 * the fixed text cost of the prompt going up and the JSON coming back.
 *
 * The text term is per CALL, not per minute, because that is how it is billed — the
 * same 2,600-token deep prompt is sent whether the clip is four seconds or four
 * minutes. Modelling it per minute (which pricing it at $0 effectively did) made
 * short segments look free, and short segments are exactly what VAD produces.
 */
export function callCost(model: ModelId, durationMs: number): number {
  return (durationMs / 60_000) * usdPerAudioMinute(model) + textCallOverhead(model);
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
 *  TTS (E-21), the realtime tutor (E-34), or Azure pronunciation assessment (E-37). */
export type BillableModelId =
  | ModelId
  | TextModelId
  | TtsModelId
  | RealtimeModelId
  | PronunciationModelId
  | SttModelId;

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

// ---- TTS model (E-21 contrastive playback, E-33/E-37 phrase renders) ------
//
// ⚠️ STILL BILLED, AND THE REPRICING BELOW STAYS. The tutor's voice left this model
// when the operator sent the speaking leg back to Realtime audio-out, but TTS is not
// dead: `lib/render/engine.ts` (E-21 contrastive renditions) and
// `lib/render/phrase.ts` (E-33 canon lines, E-37's pronunciation reference) both price
// every call through `ttsCallCost`, which IS the reservation and the cap check for
// them. Deleting this table because one consumer went away would have re-opened the
// exact under-pricing three separate spikes ordered fixed.
//
// 🚩 THE UNIT WAS WRONG, IN THE UNSAFE DIRECTION, AND THIS IS THE THIRD
// INDEPENDENT FINDING OF IT. `spike-3` (2026-07-23), `spike-5` §5.3 (2026-07-25)
// and `spike-6` §5.6 (2026-07-25) each flagged it; only the `instructions` half of
// spike-3's order ever landed. E-43 fixes the SHAPE, not just the value, because a
// value cannot express what is wrong here.
//
// `gpt-4o-mini-tts` bills **$12 per 1M audio-OUTPUT tokens** (+ $0.60/1M text-in),
// NOT $12 per 1M input characters. The per-character shape is correct for
// `tts-1`/`tts-1-hd`, which genuinely bill per character; it was carried across to a
// token-billed model and never re-derived. Measured under-pricing: **1.23×–1.76×,
// VOICE-DEPENDENT** — the same 92 characters run 5.448 s (marin) to 7.752 s (alloy),
// a 1.42× spread, because speaking rate is a property of the VOICE and a
// per-character model cannot express that at all (spike-5 §2.2/§5.3).
//
// The shape now is: characters → audio SECONDS → audio-output TOKENS → USD.
//
//   * BEFORE a call only the text is known, so `ttsCallCost` bounds the duration at
//     TTS_AUDIO_SECONDS_PER_CHARACTER, a floor over the SLOWEST voice measured. That
//     is the reservation and the cap check, so it must never be optimistic.
//   * AFTER a call the real duration is known and `ttsCostFromAudioSeconds` gives the
//     honest charge, which is what gets committed. `/v1/audio/speech` returns no
//     `usage` object, so duration is the only honest basis — and it is free to
//     obtain, because the mp3 stream is constant-bitrate (see TTS_MP3_BYTES_PER_SECOND).
//
// The tutor no longer speaks through this model, so TTS is back to what it was before
// E-43: short strings, rendered once and cached forever. That lowers the STAKES of an
// under-count; it does not make one acceptable, and the fix is already correct.

export const TTS_MODEL = "gpt-4o-mini-tts" as const;
/** The pinnable snapshot behind the floating alias. spike-5 §1: prefer pinning on a
 *  path that bills; spike-6 synthesized its entire fixture set against this id. */
export const TTS_MODEL_SNAPSHOT = "gpt-4o-mini-tts-2025-12-15" as const;
export type TtsModelId = typeof TTS_MODEL;

export interface TtsModelRate {
  /** USD per audio-OUTPUT token — the real billing unit. */
  usdPerAudioOutputToken: number;
  /** USD per TEXT-INPUT token. Small, never zero: no leg is priced at $0. */
  usdPerTextInputToken: number;
}

// [DOCUMENTED] developers.openai.com/api/docs/models/gpt-4o-mini-tts, retrieved
// 2026-07-25 (spike-5 §5.1): $0.60/1M text-in + $12.00/1M audio-out ≈ $0.015/min.
export const TTS_RATES: Record<TtsModelId, TtsModelRate> = {
  "gpt-4o-mini-tts": {
    usdPerAudioOutputToken: 12 / 1_000_000,
    usdPerTextInputToken: 0.6 / 1_000_000,
  },
};

/**
 * Audio-output tokens per second of synthesized speech. [DOCUMENTED]-derived from
 * the two published figures for the same model: $12/1M audio-output tokens ↔
 * $0.015/audio-minute ⇒ 20.83 tokens/second. spike-5 §5.3 records the derivation and
 * flags honestly that it is not directly measurable, since the endpoint returns no
 * `usage`.
 */
export const TTS_AUDIO_TOKENS_PER_SECOND = 20.83;

/**
 * Seconds of speech booked per input character — the PRE-CALL bound, used by the
 * reservation and the cap check.
 *
 * [MEASURED] spike-5 §2.2 synthesized the same 92-character sentence in five voices:
 * marin 5.448 s (0.0592 s/char) · nova 6.120 s (0.0665) · alloy-instructed 7.056 s
 * (0.0767) · coral 7.656 s (0.0832) · alloy-plain 7.752 s (**0.0843**). This books
 * **0.096**, above the SLOWEST voice measured — because the estimate must bound the
 * voice the learner actually chose, and both operator-chosen voices (`alloy`, `nova`)
 * are in that range.
 *
 * ⇒ 0.096 × 20.83 × $12/1M ≈ **$24.0 per 1M characters**, exactly the "at least
 * 24/1M" spike-5 §5.3 prescribed, and 2× the $12/1M this file used to charge.
 */
export const TTS_AUDIO_SECONDS_PER_CHARACTER = 0.096;

/**
 * Bytes per second of the mp3 this model returns. [MEASURED] spike-5 §2.2 lists
 * duration and byte size for five renditions and every one divides to exactly
 * 16,000 B/s (128 kbps CBR): 124032/7.752, 112896/7.056, 122496/7.656, 87168/5.448,
 * 97920/6.120. That constancy is what makes the honest post-call charge free — the
 * caller holds the bytes, so it knows the duration without ffprobe and without a
 * `usage` object the endpoint does not return.
 */
export const TTS_MP3_BYTES_PER_SECOND = 16_000;

/**
 * USD to synthesize `charCount` characters — the PRE-CALL upper bound that is
 * reserved and checked against the cap. Rounds the duration UP via the slowest
 * measured voice; `ttsCostFromAudioSeconds` is the honest charge once the audio
 * exists, and is never larger.
 */
export function ttsCallCost(model: TtsModelId, charCount: number): number {
  const chars = Math.max(0, charCount);
  const r = TTS_RATES[model];
  const audioSeconds = chars * TTS_AUDIO_SECONDS_PER_CHARACTER;
  return (
    audioSeconds * TTS_AUDIO_TOKENS_PER_SECOND * r.usdPerAudioOutputToken +
    estimateTokens("x".repeat(chars)) * r.usdPerTextInputToken
  );
}

/** USD for `seconds` of synthesized speech plus its `charCount`-sized prompt — the
 *  honest charge, computed from the audio that actually came back. */
export function ttsCostFromAudioSeconds(model: TtsModelId, seconds: number, charCount: number): number {
  const r = TTS_RATES[model];
  return (
    Math.max(0, seconds) * TTS_AUDIO_TOKENS_PER_SECOND * r.usdPerAudioOutputToken +
    estimateTokens("x".repeat(Math.max(0, charCount))) * r.usdPerTextInputToken
  );
}

/** Seconds of speech in `byteCount` bytes of this model's mp3 output. */
export function ttsAudioSecondsFromMp3Bytes(byteCount: number): number {
  return Math.max(0, byteCount) / TTS_MP3_BYTES_PER_SECOND;
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

// ---- realtime tutor (E-34, rebuilt for E-43) -----------------------------
//
// The spoken tutor both listens AND speaks over the **Realtime** API — audio in,
// audio out, one connection. Its price table and cost model live in
// ./rates-realtime.ts purely so both files stay under the 500-line hook; every name is
// re-exported here, so lib/analysis/rates.ts remains the ONE import surface for prices
// (D-10) and no caller needs to know about the split.
//
// Realtime spend records into the SAME spend_ledger under the SAME monthly cap as
// everything else.
export {
  REALTIME_FLAGSHIP,
  REALTIME_MINI,
  REALTIME_TIERS,
  DEFAULT_REALTIME_TIER,
  isRealtimeTier,
  realtimeModelForTier,
  REALTIME_RATES,
  REALTIME_AUDIO_TOKENS_PER_MINUTE,
  REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE,
  REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE,
  REALTIME_FRESH_TEXT_TOKENS_PER_MINUTE,
  REALTIME_TURNS_PER_MINUTE,
  REALTIME_CONTEXT_TOKENS_PER_TURN,
  REALTIME_SESSION_PROMPT_TOKENS,
  REALTIME_MIN_BILLED_MINUTES,
  realtimeCachedTokens,
  realtimeCostBreakdown,
  realtimeSessionCost,
  tutorRealtimeModel,
} from "./rates-realtime";
export type { RealtimeModelId, RealtimeModelRate, RealtimeCostBreakdown, RealtimeTier } from "./rates-realtime";

// ---- pronunciation assessment (E-37) --------------------------------------
//
// The pronunciation studio scores a scripted drill through **Azure AI Speech
// Pronunciation Assessment** (it-IT) — the FIRST non-OpenAI provider to bill into this
// ledger. It is a different vendor, not a different money path: its spend records into
// the SAME `spend_ledger` under the SAME monthly cap through the SAME reserve-before-
// call discipline (D-10, D-21).
//
// BILLING UNIT: **audio seconds**. PA costs the same as plain speech-to-text for the
// scores it-IT can return; the only add-on-billed score is PROSODY, which is en-US
// only — so an Italian assessment can never incur the add-on, and this one flat rate
// is the whole model (OBS-002 §1.5, live-verified 2026-07-24).
//
// VALIDATED 2026-07-24 (OBS-002): real-time standard STT ≈ $1.00 per AUDIO HOUR,
// billed per second ⇒ a 6-second drill ≈ $0.0017. Azure's own pricing page returns 403
// to automated fetch from this sandbox, so an operator should eyeball the live number
// before it is quoted anywhere; like every other number in this file it is the single
// price knob, an explicit approximation, and owed a reconciliation against a real
// invoice ([RETRO-002 T1] — the cap guards the MODELED budget, and modeled ≠ invoiced).

export const PA_MODEL = "azure-pronunciation-it-IT" as const;
export type PronunciationModelId = typeof PA_MODEL;

export interface PronunciationModelRate {
  /** USD charged per HOUR of audio assessed (billed per second). */
  usdPerAudioHour: number;
}

export const PA_RATES: Record<PronunciationModelId, PronunciationModelRate> = {
  "azure-pronunciation-it-IT": { usdPerAudioHour: 1.0 },
};

/** USD to assess `seconds` of audio, per the rates table — the reserved estimate and,
 *  recomputed from the real duration, the finalized charge. Never negative. */
export function pronunciationCallCost(model: PronunciationModelId, seconds: number): number {
  return (Math.max(0, seconds) / 3600) * PA_RATES[model].usdPerAudioHour;
}
