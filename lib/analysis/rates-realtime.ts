// The Realtime tutor's price table (E-34, rebuilt for E-43). Split out of
// lib/analysis/rates.ts — which re-exports every name here, so `rates.ts` stays
// the ONE import surface for prices (D-10) — purely to keep both files under the
// 500-line hook.
//
// WHAT CHANGED IN E-43, AND WHY THE OLD TABLE WAS WRONG BY 5.1×.
//
// D-28 (settled by `docs/research/spike-6-tutor-listening.md`, ~130 live calls)
// keeps the tutor on the Realtime API but takes its reply as **TEXT**
// (`output_modalities: ["text"]`) and speaks it through TTS. So the $64/1M
// audio-OUTPUT leg — which was the bulk of realtime's cost, and the entire reason
// D-26 argued for leaving Realtime — is never generated at all.
//
// The old model charged 1500 audio-output tokens per elapsed minute at $64/1M for
// audio that will never exist, and carried NO text-token rates whatsoever. Measured
// result: **$1.44 modelled against $0.283 real — a 5.1× over-book** (spike-6 §5.6).
// Over-booking is the safe direction, but 5.1× is large enough to refuse a learner
// who genuinely has budget, and a cap that lies in the generous direction is still a
// cap that lies.
//
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
// Every constant below therefore clears the MAXIMUM spike-6 measured, not its mean,
// and `tests/rates-voice-floor.test.ts` pins each leg against those measurements at
// nine durations — the same discipline `tests/rates-text-floor.test.ts` applies to
// the analysis path. The prose defers to the test: this repo has been bitten three
// times by a money property asserted only in a comment.

export const REALTIME_FLAGSHIP = "gpt-realtime-2.1" as const;
export const REALTIME_MINI = "gpt-realtime-2.1-mini" as const;
export type RealtimeModelId = typeof REALTIME_FLAGSHIP | typeof REALTIME_MINI;

/**
 * The tutor's listening model. A CODE DEFAULT with an env override, not a Settings
 * knob (E-43, D-26).
 *
 * The `realtimeTier` switch this replaces let a learner pick `gpt-realtime-2.1-mini`
 * — which spike-6 §3.1 measured as unfit for the tutor's core job: 3 empty replies
 * and 2 hallucinated errors on clean speech out of 9 fixtures, against the flagship's
 * 5/7 caught with ZERO hallucinations. Offering a choice between "works" and
 * "invents corrections" is not a feature; `PRECISION_CORE_LINES` calls a false
 * correction worse than a missed one. The override exists for operators and tests,
 * and whatever it selects is priced by the table below.
 */
export function tutorRealtimeModel(
  raw: string | undefined = process.env.TUTOR_REALTIME_MODEL,
): RealtimeModelId {
  return raw === REALTIME_MINI ? REALTIME_MINI : REALTIME_FLAGSHIP;
}

export interface RealtimeModelRate {
  /** USD per audio-INPUT token (the learner's speech reaching the model). */
  usdPerAudioInputToken: number;
  /** USD per CACHED audio-input token — the conversation's own audio, re-sent on
   *  every turn and served from the prompt cache at ~80× discount (spike-6 §5.5). */
  usdPerCachedAudioInputToken: number;
  /** USD per TEXT-INPUT token — the persona and the conversation carried as text. */
  usdPerTextInputToken: number;
  /** USD per CACHED text-input token. Measured 96%+ hit rate on a warm session. */
  usdPerCachedTextInputToken: number;
  /** USD per TEXT-OUTPUT token — under D-28 this is the tutor's whole reply,
   *  reasoning tokens included. The dominant output cost, and a rate the old table
   *  did not have at all. */
  usdPerTextOutputToken: number;
  /** USD per audio-OUTPUT token. Retained for provenance and priced honestly, but
   *  NOT charged by `realtimeSessionCost`: `output_modalities: ["text"]` means no
   *  audio output is ever generated. Charging it is exactly the 5.1× defect. */
  usdPerAudioOutputToken: number;
}

// Unit prices [DOCUMENTED], `developers.openai.com/api/docs/pricing`, retrieved
// 2026-07-25 and tabulated in spike-6 §5.4, per 1M tokens:
//
//   gpt-realtime-2.1       text in $4.00 · cached $0.40 · text out $24.00
//                          audio in $32.00 · cached audio $0.40 · audio out $64.00
//   gpt-realtime-2.1-mini  text in $0.60 · cached $0.06 · text out $2.40
//                          audio in $10.00 · cached audio $0.30 · audio out $20.00
//
// Note the flagship TEXT-OUTPUT rate is **$24/1M**, not the $16 the older
// `gpt-realtime` model page shows — spike-6 §5.4 flags that trap explicitly.
export const REALTIME_RATES: Record<RealtimeModelId, RealtimeModelRate> = {
  "gpt-realtime-2.1": {
    usdPerAudioInputToken: 32 / 1_000_000,
    usdPerCachedAudioInputToken: 0.4 / 1_000_000,
    usdPerTextInputToken: 4 / 1_000_000,
    usdPerCachedTextInputToken: 0.4 / 1_000_000,
    usdPerTextOutputToken: 24 / 1_000_000,
    usdPerAudioOutputToken: 64 / 1_000_000,
  },
  "gpt-realtime-2.1-mini": {
    usdPerAudioInputToken: 10 / 1_000_000,
    usdPerCachedAudioInputToken: 0.3 / 1_000_000,
    usdPerTextInputToken: 0.6 / 1_000_000,
    usdPerCachedTextInputToken: 0.06 / 1_000_000,
    usdPerTextOutputToken: 2.4 / 1_000_000,
    usdPerAudioOutputToken: 20 / 1_000_000,
  },
};

/**
 * Audio-INPUT tokens booked per ELAPSED conversation minute.
 *
 * spike-6 §5.4 measured **10.47 tokens/second = 628 per AUDIO-minute** from real
 * `usage` across 10 clips (spread 505–665). This books **700 per ELAPSED minute**,
 * which is conservative twice over: above the measured maximum of the spread, and
 * charging every elapsed minute as if the learner spoke through all of it when a
 * real conversation is roughly half tutor. The server cannot know the split, so the
 * bound is the whole minute.
 */
export const REALTIME_AUDIO_TOKENS_PER_MINUTE = 700;

/**
 * TEXT-OUTPUT tokens booked per elapsed minute — the tutor's reply under D-28,
 * reasoning tokens included.
 *
 * spike-6 §5.2 measured 42–388 output tokens per reply with 33–220 of reasoning, at
 * ~2 turns/minute ⇒ ~240 tokens/minute observed. This books **600**, 2.5× the
 * observed rate. It is also bounded by physics in a way a per-turn figure is not:
 * the reply is SPOKEN through TTS, and 600 tokens/minute is already ~450 words per
 * minute, roughly three times what any voice can utter.
 */
export const REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE = 600;

/**
 * FRESH (uncached) text-input tokens booked per elapsed minute — the new text each
 * turn adds. spike-6 §5.5 measured fresh increments of 72–201 tokens per turn after
 * the first at ~2 turns/minute ⇒ ~256/minute. This books **600**.
 */
export const REALTIME_FRESH_TEXT_TOKENS_PER_MINUTE = 600;

/**
 * Turns booked per elapsed minute. spike-6 models a 10-minute conversation as 20
 * turns (2/minute); this books **2.5**. It scales the CACHED re-send term below,
 * which is quadratic, so it is deliberately not inflated further — over-booking a
 * quadratic compounds, and that is precisely how the old table reached 5.1×.
 */
export const REALTIME_TURNS_PER_MINUTE = 2.5;

/**
 * Tokens each turn ADDS to the conversation context, and therefore to every
 * subsequent turn's cached re-send. spike-6 §5.5 measured per-turn growth of ~47–68
 * audio + 72–201 fresh text + ~120 output ⇒ ~390 at the maximum. This books **600**.
 */
export const REALTIME_CONTEXT_TOKENS_PER_TURN = 600;

/**
 * The persona's text-token size, booked as a FLOOR over what `buildTutorPersona`
 * actually produces — pinned by `tests/rates-voice-floor.test.ts` against the real
 * builder at its own caps, so growing the persona turns a test red rather than
 * turning the cap quietly wrong. Measured worst case today: 10,920 chars ≈ 2,730
 * tokens.
 */
export const REALTIME_SESSION_PROMPT_TOKENS = 3200;

/**
 * The shortest session that may be billed, in minutes.
 *
 * A per-minute rate is not a safe floor for a SHORT call — spike-6's general lesson —
 * because the persona is sent whole however brief the call is, and at least one turn
 * happens. A 20-second session that opened, greeted and heard one reply has already
 * incurred a full persona send plus a reply; charging it a third of a minute would
 * under-book it. So a session bills at least one minute.
 */
export const REALTIME_MIN_BILLED_MINUTES = 1;

/** One session's cost, broken out per billed leg — the shape the floor test asserts
 *  against spike-6's measured legs, rather than checking one conflated total. */
export interface RealtimeCostBreakdown {
  /** The persona, sent once uncached at session open. */
  promptUsd: number;
  /** The learner's speech, every elapsed minute booked as speech. */
  audioInUsd: number;
  /** The reply text (D-28). No audio-output leg exists to charge. */
  textOutUsd: number;
  /** New text each turn adds, uncached. */
  freshTextInUsd: number;
  /** The conversation re-sent on every turn, served from the prompt cache. */
  cachedInUsd: number;
  totalUsd: number;
  /** The minutes actually billed (`max(minutes, REALTIME_MIN_BILLED_MINUTES)`). */
  billedMinutes: number;
}

/**
 * Cached input tokens a session of `minutes` re-sends. Realtime re-sends the WHOLE
 * conversation on every turn, so this is quadratic in the turn count — but 96%+ of
 * it hits the prompt cache at $0.40/1M instead of $4.00 (text) or $32.00 (audio),
 * which is why the quadratic is affordable in practice (spike-6 §5.5).
 *
 * Modelled as `turns × (persona + average accumulated context)`, with the average
 * accumulation being half the final one — i.e. the area under the growth line.
 */
export function realtimeCachedTokens(minutes: number): number {
  const turns = Math.max(0, minutes) * REALTIME_TURNS_PER_MINUTE;
  return turns * (REALTIME_SESSION_PROMPT_TOKENS + (REALTIME_CONTEXT_TOKENS_PER_TURN * turns) / 2);
}

/** Every billed leg of a `minutes`-long conversation on `model`. */
export function realtimeCostBreakdown(model: RealtimeModelId, minutes: number): RealtimeCostBreakdown {
  const r = REALTIME_RATES[model];
  const billedMinutes = Math.max(Math.max(0, minutes), REALTIME_MIN_BILLED_MINUTES);
  const promptUsd = REALTIME_SESSION_PROMPT_TOKENS * r.usdPerTextInputToken;
  const audioInUsd = billedMinutes * REALTIME_AUDIO_TOKENS_PER_MINUTE * r.usdPerAudioInputToken;
  const textOutUsd = billedMinutes * REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE * r.usdPerTextOutputToken;
  const freshTextInUsd = billedMinutes * REALTIME_FRESH_TEXT_TOKENS_PER_MINUTE * r.usdPerTextInputToken;
  const cachedInUsd = realtimeCachedTokens(billedMinutes) * r.usdPerCachedTextInputToken;
  return {
    promptUsd,
    audioInUsd,
    textOutUsd,
    freshTextInUsd,
    cachedInUsd,
    totalUsd: promptUsd + audioInUsd + textOutUsd + freshTextInUsd + cachedInUsd,
    billedMinutes,
  };
}

/** USD to run `minutes` of conversation on `model` — the per-session estimate and
 *  the reserved lease amount. Never negative, never below one billed minute. */
export function realtimeSessionCost(model: RealtimeModelId, minutes: number): number {
  return realtimeCostBreakdown(model, minutes).totalUsd;
}

