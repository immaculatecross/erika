// The Realtime tutor's price table (E-34, rebuilt for E-43, re-derived for its
// Amendment-5 revision). Split out of lib/analysis/rates.ts — which re-exports every
// name here, so `rates.ts` stays the ONE import surface for prices (D-10) — purely to
// keep both files under the 500-line hook.
//
// ── WHY THIS TABLE HAS NOW BEEN DERIVED THREE TIMES ──────────────────────────
//
// 1. **E-34's table** priced 1 500 audio-output tokens per elapsed minute at $64/1M
//    and carried NO text-token rates at all. Modelled $1.44 against a real $0.283 —
//    a **5.1× over-book**, safe in direction but big enough to refuse a learner who
//    genuinely had budget, and the missing text leg was priced at $0 outright, which
//    is the one thing this file's doctrine forbids (spike-6 §5.6).
//
// 2. **E-43's first table** took D-28's reply-as-text shape and removed the audio-out
//    leg entirely, because `output_modalities: ["text"]` really does generate no
//    audio output.
//
// 3. **THIS table** puts it back. The operator drove the text-out tutor, rejected its
//    4.5–5.0 s lag, and sent the speaking leg back to Realtime audio-out. That
//    restores the $64/1M audio-output leg AND re-feeds the tutor's own audio into the
//    context at $32/1M rather than text at $4/1M, so a rate derived from the text-out
//    shape is now wrong in the UNSAFE direction — it would price a leg that exists at
//    zero, which is defect (1) all over again in a different place.
//
//    `docs/research/spike-7-realtime-voices.md` measured what (2) could not: audio
//    output runs at **20.00 tokens/second (1 200 per audio-minute)** across all ten
//    voices from real `usage` (§5.2, per-voice spread 19.2–20.1 — the DURATION varies
//    by voice, the tokens-per-second does not), and a 10-minute conversation on
//    flagship models at **$0.830** against $0.354 for the same conversation with
//    text-out on identical assumptions (§5.3). Every constant below is derived from
//    those measurements or from spike-6's, and named as such.
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
// EVERY LEG IS INDIVIDUALLY A FLOOR, and that is the property that matters rather
// than the total. E-34's table was safe only in AGGREGATE — an inflated audio leg
// masked a text leg priced at zero — which is exactly how a missing leg survives
// review. `tests/rates-voice-floor.test.ts` therefore pins each leg separately
// against spike-6's and spike-7's measurements at nine durations, the same discipline
// `tests/rates-text-floor.test.ts` applies to the analysis path. The prose defers to
// the test: this repo has been bitten three times by a money property asserted only
// in a comment.

export const REALTIME_FLAGSHIP = "gpt-realtime-2.1" as const;
export const REALTIME_MINI = "gpt-realtime-2.1-mini" as const;
export type RealtimeModelId = typeof REALTIME_FLAGSHIP | typeof REALTIME_MINI;

/**
 * The two tiers the tutor may run on, and the ONE Settings choice between them.
 *
 * This knob was deleted earlier on this branch and is deliberately back, by operator
 * ruling once the honest flagship price was in front of them: *"we can't spend one
 * hundred dollars per month per user… either we use realtime mini, and I'm not sure if
 * this works or not — worth putting that in the settings that I can try."*
 *
 * ⚠️ THE TWO TIERS ARE NOT INTERCHANGEABLE AND THE SETTINGS COPY SAYS SO. spike-6 §3.1
 * measured `gpt-realtime-2.1-mini` producing **3 empty replies and 2 hallucinated
 * errors on clean speech out of 9 fixtures**, against the flagship's 5/7 caught with
 * ZERO hallucinations. For a tutor, INVENTING a correction is the worst available
 * failure — it teaches the learner something false about their own Italian and
 * devalues every real correction after it (`PRECISION_CORE_LINES`: a false correction
 * is worse than a missed one). That is why the default is the flagship and why the
 * choice is presented with one true sentence rather than as a neutral preference.
 */
export const REALTIME_TIERS = ["flagship", "mini"] as const;
export type RealtimeTier = (typeof REALTIME_TIERS)[number];

/** The default tier. Flagship, by operator ruling — *"let's use flagship then"* — made
 *  with spike-6's hallucination measurement in front of them. */
export const DEFAULT_REALTIME_TIER: RealtimeTier = "flagship";

export function isRealtimeTier(x: unknown): x is RealtimeTier {
  return typeof x === "string" && (REALTIME_TIERS as readonly string[]).includes(x);
}

export function realtimeModelForTier(tier: RealtimeTier): RealtimeModelId {
  return tier === "mini" ? REALTIME_MINI : REALTIME_FLAGSHIP;
}

/**
 * The tutor's model when no tier is supplied — the env override, then the default.
 * Both tiers are priced by the table below; neither is a rate the cap has to guess at.
 */
export function tutorRealtimeModel(
  raw: string | undefined = process.env.TUTOR_REALTIME_MODEL,
): RealtimeModelId {
  return raw === REALTIME_MINI ? REALTIME_MINI : realtimeModelForTier(DEFAULT_REALTIME_TIER);
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
  /** USD per TEXT-OUTPUT token. Under audio-out the reply itself is audio, but the
   *  model still emits text output — spike-7 §4.2 measured 163–304 text-output tokens
   *  per turn alongside the audio, reasoning included, on production-shaped turns. A
   *  leg that is smaller is not a leg that is free; E-34 priced this one at $0. */
  usdPerTextOutputToken: number;
  /** USD per audio-OUTPUT token — the tutor's own voice. The single largest leg of a
   *  conversation (spike-7 §5.3: $0.382 of $0.830 over 10 minutes) and the one the
   *  text-out design removed. */
  usdPerAudioOutputToken: number;
}

// Unit prices [DOCUMENTED], `developers.openai.com/api/docs/pricing` and
// `…/models/gpt-realtime-2.1`, retrieved 2026-07-25 and tabulated independently by
// spike-6 §5.4 and spike-7 §5.1, which agree on all six rates. Per 1M tokens:
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
 * Audio-INPUT tokens booked per ELAPSED conversation minute — every audio token that
 * enters the model, from whatever direction.
 *
 * spike-6 §5.4 measured **10.47 tokens/second = 628 per AUDIO-minute** from real
 * `usage` across 10 clips (spread 505–665), and this revision's own runs agree: a
 * 5.15 s learner turn arrived as **51 audio-input tokens** (9.9 tok/s). A learner
 * speaking every second of a minute is therefore ~630 tokens.
 *
 * This books **1 200**, roughly double that, and the doubling is deliberate insurance
 * against the leg described below.
 *
 * 🚩 WHERE DOES THE TUTOR'S OWN REPLY GO? spike-7 §5.3 and an independent money review
 * both expected it to re-enter the next turn's context as ~300 AUDIO tokens at $32/1M
 * — the review flagged pricing it as text at $4/1M as "the easiest leg to miss", and
 * it would be. So it was measured rather than assumed. On this revision's live
 * answered-tool turns the prompt grew by **+133 TEXT tokens** between the holding
 * response and the continuation, with audio input flat at 51: the model re-feeds its
 * own spoken reply as its TRANSCRIPT, not as audio.
 *
 * That is a measurement against two documents, on n=2 sessions, so it is not treated
 * as settled. Rather than carry a separate audio re-entry leg that the data
 * contradicts, the audio leg is doubled — which prices ~570 tokens/minute of
 * re-entering audio at the full audio rate if the behaviour ever differs, and the
 * measured text growth is covered independently by
 * REALTIME_FRESH_TEXT_TOKENS_PER_MINUTE (600/min booked against ~333/min measured).
 * The conservatism the review asked for is kept; the claim it rested on is not
 * asserted as fact.
 */
export const REALTIME_AUDIO_TOKENS_PER_MINUTE = 1200;

/**
 * AUDIO-OUTPUT tokens booked per ELAPSED conversation minute — the tutor's own voice,
 * and the leg the text-out design deleted.
 *
 * 🚩 TWO SOURCES DISAGREED BY 2× ON THIS NUMBER, SO IT WAS MEASURED AGAIN. spike-7
 * §5.2 derived **20.00 tokens/second (1 200 per AUDIO-minute)** from real `usage`
 * across ten voices; an independent money review of this branch measured **9.93
 * tok/s (596/min)** and proposed booking 700 per elapsed minute on that basis.
 *
 * This revision re-measured it on the exact shipping configuration — nine labelled
 * fixtures, `gpt-realtime-2.1`, `output_modalities: ["audio"]`, the real persona — and
 * got **exactly 20.0 tokens per second of speech on all seven turns that completed**
 * (86 tok/4.30 s · 104/5.20 · 389/19.45 · 106/5.30 · 264/13.20 · 102/5.10 · 95/4.75).
 * spike-7 is right, and 700 per elapsed minute would UNDER-book: the same run produced
 * a 19.45 s reply to a 5.15 s learner turn, i.e. the tutor speaking ~78% of the
 * elapsed time, which is 936 audio-output tokens in that minute alone.
 *
 * So this books **1 250 per ELAPSED minute** — above 1 200, and charging every elapsed
 * minute as if the TUTOR spoke through all of it. `REALTIME_AUDIO_TOKENS_PER_MINUTE`
 * below books the same minute as LEARNER speech at the same time. Both cannot be true
 * of one minute; that double-booking is deliberate and is what makes this a floor,
 * because the server cannot observe the split and a guessed ratio is the thing that
 * turns a cap into a lie.
 *
 * ⚠️ AND AUDIO INPUT IS NEVER SERVED FROM THE PROMPT CACHE. Measured on the same runs:
 * `cached_tokens_details` came back `{text_tokens: 2368, audio_tokens: 0}` on every
 * warm call. So no audio leg here may be discounted at a cached rate, however good the
 * overall hit rate looks — the cache is entirely a text-side effect.
 */
export const REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE = 1250;

/**
 * TEXT-OUTPUT tokens booked per elapsed minute. Under audio-out the reply is spoken,
 * but text output does not go to zero — spike-7 §4.2 measured 163–304 text-output
 * tokens per production-shaped turn (reasoning included) ALONGSIDE the audio, and
 * spike-6 §5.2 measured 42–388 on the text-out shape. At ~2.5 turns/minute the worst
 * observed is ~760/minute, so this books **900**.
 *
 * This went UP from the text-out table's 600. That table justified 600 partly by
 * physics — "600 tokens/minute is ~450 words per minute, three times what any voice
 * can utter" — and that argument does not survive audio-out, because these tokens are
 * no longer what is spoken. Reasoning tokens are not bounded by a speaking rate.
 */
export const REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE = 900;

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
 * subsequent turn's cached re-send.
 *
 * Under text-out this booked 600 against spike-6 §5.5's measured ~390 maximum. Under
 * audio-out a turn adds MORE, because the tutor's own reply is now audio: this
 * revision's own live runs measured a single answered turn growing the prompt by 133
 * tokens on top of ~300 audio-output tokens that become context, and spike-7 §5.3 puts
 * the reply's own contribution at ~300 audio tokens against text-out's ~225 text ones.
 * This books **1 200**.
 *
 * ⚠️ It scales a QUADRATIC leg, so it is the one constant here where over-booking
 * compounds — that is exactly how E-34's table reached 5.1×. It is doubled rather than
 * inflated freely, and `tests/rates-voice-floor.test.ts` bounds the resulting total
 * from above as well as below so the compounding cannot run away unnoticed.
 */
export const REALTIME_CONTEXT_TOKENS_PER_TURN = 1200;

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
 *  against spike-6's and spike-7's measured legs, rather than checking one conflated
 *  total. A conflated total is how E-34's table stayed "safe" while pricing a whole
 *  leg at zero. */
export interface RealtimeCostBreakdown {
  /** The persona, sent once uncached at session open. */
  promptUsd: number;
  /** The learner's speech, every elapsed minute booked as speech. */
  audioInUsd: number;
  /** The tutor's own voice — the largest leg, and the one audio-out restores. */
  audioOutUsd: number;
  /** Text output the model emits alongside the audio, reasoning included. */
  textOutUsd: number;
  /** New text each turn adds, uncached — including the transcript of the tutor's own
   *  spoken reply, which is how it was MEASURED to re-enter the context. */
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

/**
 * The rate one CACHED input token is booked at: the more expensive of the model's two
 * cached rates.
 *
 * MEASURED on this revision's live runs, the cache is entirely a text-side effect:
 * `cached_tokens_details` came back `{text_tokens: 2368, audio_tokens: 0}` on every
 * warm call, at a **92.5–97.6% hit rate** on total input tokens. So in practice the
 * cached bucket is text and the text rate would be exact.
 *
 * It still takes the dearer of the two rates, because n is small and the direction of
 * being wrong is not symmetric: on flagship both cached rates are $0.40/1M so the
 * question does not arise, and on mini cached audio is $0.30/1M against cached text at
 * $0.06/1M — a 5× gap that would become an under-book the moment any audio did land in
 * the cache.
 */
function cachedInputRate(r: RealtimeModelRate): number {
  return Math.max(r.usdPerCachedTextInputToken, r.usdPerCachedAudioInputToken);
}

/** Every billed leg of a `minutes`-long conversation on `model`. */
export function realtimeCostBreakdown(model: RealtimeModelId, minutes: number): RealtimeCostBreakdown {
  const r = REALTIME_RATES[model];
  const billedMinutes = Math.max(Math.max(0, minutes), REALTIME_MIN_BILLED_MINUTES);
  const promptUsd = REALTIME_SESSION_PROMPT_TOKENS * r.usdPerTextInputToken;
  const audioInUsd = billedMinutes * REALTIME_AUDIO_TOKENS_PER_MINUTE * r.usdPerAudioInputToken;
  const audioOutUsd = billedMinutes * REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE * r.usdPerAudioOutputToken;
  const textOutUsd = billedMinutes * REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE * r.usdPerTextOutputToken;
  const freshTextInUsd = billedMinutes * REALTIME_FRESH_TEXT_TOKENS_PER_MINUTE * r.usdPerTextInputToken;
  const cachedInUsd = realtimeCachedTokens(billedMinutes) * cachedInputRate(r);
  return {
    promptUsd,
    audioInUsd,
    audioOutUsd,
    textOutUsd,
    freshTextInUsd,
    cachedInUsd,
    totalUsd: promptUsd + audioInUsd + audioOutUsd + textOutUsd + freshTextInUsd + cachedInUsd,
    billedMinutes,
  };
}

/**
 * USD to run `minutes` of conversation on `model` — the per-session estimate and the
 * reserved lease amount. Never negative, never below one billed minute.
 *
 * HOW FAR ABOVE REALITY THIS SITS, stated rather than left to be discovered: a
 * 10-minute flagship conversation models **$1.67** here against spike-7 §5.3's
 * **$0.830** on its own measured assumptions — **2.0×** — and mini models $0.517
 * against $0.227, **2.3×**. Almost all of that is the deliberate double-booking of
 * each elapsed minute as BOTH learner speech and tutor speech.
 *
 * That is the safe direction and it is a large improvement on E-34's 5.1×, but it is
 * not free: the cap refuses at half the headroom a learner really has.
 * `tests/rates-voice-floor.test.ts` pins the multiple from BOTH sides — every leg at
 * or above measured reality, and the total no more than 2.5× it — so a future edit
 * that drifts back toward either 5× or $0 turns a test red instead of a cap into a
 * lie. A one-sided floor is what let the old table hide a leg priced at zero.
 */
export function realtimeSessionCost(model: RealtimeModelId, minutes: number): number {
  return realtimeCostBreakdown(model, minutes).totalUsd;
}

