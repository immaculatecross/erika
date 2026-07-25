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
// audio-input price. Both moves make the model match the invoice's shape. The
// resulting all-in figures sit ABOVE D-20's modelled $0.22 per 10-min capture and
// $1.77 per 12-h dump — deliberately, since D-20's numbers were computed before the
// prompt quadrupled. The standing usage→invoice reconciliation ([RETRO-002 T1]) is
// still what should eventually replace every estimate here with a measurement; the
// cap guards the MODELLED budget, not the invoice.
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
export type BillableModelId = ModelId | TextModelId | TtsModelId | RealtimeModelId | PronunciationModelId;

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
// legacy `gpt-4o-realtime-preview` is not used. Both ids are real — they appear in
// the first-party SDK model unions (`openai-python` `types/realtime/`,
// `openai-node` `resources/realtime/calls.ts`), which enumerate
// `gpt-realtime-1.5` | `gpt-realtime-2` | `gpt-realtime-2.1` |
// `gpt-realtime-2.1-mini` | `gpt-realtime-2025-08-28`. This family moved from dated
// snapshots to semver-style version ids, so `gpt-realtime-2.1` IS the pinned
// snapshot; there is no dated variant to prefer.

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
// So a rate here must be at or ABOVE reality. If a figure cannot be verified, round
// it UP and say so on the line; never round down, and never "split the difference".
//
// VERIFIED 2026-07-24 by live research (the sandbox cannot reach
// `platform.openai.com` / `developers.openai.com` — both 403 at the egress gateway —
// so these came from machine-readable mirrors of OpenAI's own model pages, agreeing
// across four+ independent sources): assistant-ui/modelpedia
// (`providers/openai/models/gpt-realtime-2.1{,-mini}.json`, which mirrors the docs
// pricing table verbatim and links back to it, 2026-07-08/09), mlflow's
// `model_catalog/openai.json` (`last_updated_at: 2026-07-10`), LiteLLM's
// `model_prices_and_context_window.json`, and promptfoo's OpenAI provider table.
// This repo's own `docs/research/spike-3-extraction-tutor.md` already carried the
// same mini figures with citations — the table below had simply not been updated
// from it.
//
//   gpt-realtime-2.1       audio in $32 / 1M · cached in $0.40 / 1M · out $64 / 1M
//   gpt-realtime-2.1-mini  audio in $10 / 1M · cached in $0.30 / 1M · out $20 / 1M
//
// The MINI row was previously a placeholder set at ~¼ of flagship ($8/$0.10/$16)
// when no published figure was to hand. That UNDER-priced mini audio by 20% (real
// rates are 25% higher than modelled) and cached mini audio by 3× — exactly the
// unsafe direction, so it is corrected upward here. The FLAGSHIP row was already
// right and is unchanged.
//
// Still the single price knob, and still an approximation in one respect: the
// per-minute cost multiplies these by an assumed token throughput (below). The
// standing T1 reconciliation — real `usage` from a live run against the invoice —
// remains the real fix; the cap guards the MODELLED budget, not the invoice.
export const REALTIME_RATES: Record<RealtimeModelId, RealtimeModelRate> = {
  "gpt-realtime-2.1": {
    usdPerAudioInputToken: 32 / 1_000_000,
    usdPerCachedAudioInputToken: 0.4 / 1_000_000,
    usdPerAudioOutputToken: 64 / 1_000_000,
  },
  "gpt-realtime-2.1-mini": {
    usdPerAudioInputToken: 10 / 1_000_000,
    usdPerCachedAudioInputToken: 0.3 / 1_000_000,
    usdPerAudioOutputToken: 20 / 1_000_000,
  },
};

/**
 * Assumed audio-token throughput PER ELAPSED CONVERSATION MINUTE, split by
 * direction. A spoken exchange has both parties active across a minute, and the
 * pre-call estimate must never UNDER-price (see the asymmetry note above the rate
 * table), so this deliberately over-books: ~1500 input + ~1500 output tokens per
 * elapsed minute, 3000/min all in.
 *
 * That is a CONSERVATIVE OVER-ESTIMATE, on purpose. The figures reachable in
 * 2026-07 research put realtime audio nearer ~600 input + ~1200 output tokens per
 * minute (~1800/min — see `docs/research/spike-3-extraction-tutor.md` and its
 * citations), so the default books roughly 1.7× the expected throughput. Left high
 * because it is unverified against this account's real `usage`: an over-estimate
 * only refuses slightly early, while an under-estimate would let real spend pass the
 * cap. Tunable via env; the T1 usage→invoice reconciliation is what should eventually
 * lower it (D-13). This is the ONE place the per-minute realtime cost is derived.
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
