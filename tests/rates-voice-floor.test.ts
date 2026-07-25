import { describe, expect, it } from "vitest";
import { REGISTERS } from "@/lib/register";
import { PROFILE_MAX_CHARS } from "@/lib/analysis/profile";
import { buildTutorPersona } from "@/lib/tutor/persona";
import {
  REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE,
  REALTIME_AUDIO_TOKENS_PER_MINUTE,
  REALTIME_FLAGSHIP,
  REALTIME_MINI,
  REALTIME_RATES,
  REALTIME_SESSION_PROMPT_TOKENS,
  REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE,
  TTS_AUDIO_SECONDS_PER_CHARACTER,
  TTS_AUDIO_TOKENS_PER_SECOND,
  TTS_MODEL,
  TTS_MP3_BYTES_PER_SECOND,
  TTS_RATES,
  estimateTokens,
  realtimeCostBreakdown,
  realtimeSessionCost,
  ttsAudioSecondsFromMp3Bytes,
  ttsCallCost,
  ttsCostFromAudioSeconds,
} from "@/lib/analysis/rates";

// THE VOICE LEGS ARE FLOORS OVER MEASURED REALITY (E-43 criteria 9, 12, 19).
//
// This is the companion sweep to `tests/rates-text-floor.test.ts`, which pins the
// ANALYSIS path the same way and must keep passing untouched. Same doctrine, stated
// at rates.ts:57 and rates-realtime.ts: over-estimating a rate costs a slightly early
// refusal; UNDER-estimating makes the cap a LIE. So every assertion here is a
// `toBeGreaterThanOrEqual` against a number this repo MEASURED on a live account, and
// each is asserted PER LEG rather than on one conflated total — a total can survive
// while a leg inside it is under-priced.
//
// THREE independent defects are guarded here, all of which shipped:
//
//   * `REALTIME_RATES` had NO text-token rates at all, and `realtimePerMinuteUsd`
//     charged 1500 audio-OUTPUT tokens/minute at $64/1M. Measured: $1.44 modelled
//     against $0.283 real — a 5.1× OVER-book (spike-6 §5.6). Safe direction, but
//     large enough to refuse a learner who has budget.
//   * The text-out rebuild then removed the audio-OUTPUT leg entirely, which was
//     correct while `output_modalities` was `["text"]` and became an UNDER-book the
//     moment the operator sent the speaking leg back to audio-out. This file used to
//     assert the leg's ABSENCE; that assertion is now a floor on its presence (below).
//     A test rewritten to agree with whatever the code does is how a defect becomes a
//     contract, so the replacement derives its number from `usage`, not from the model.
//   * `TTS_RATES` billed per input CHARACTER at the audio-output-token rate:
//     1.23×–1.76× UNDER, voice-dependent (spike-5 §5.3). Third independent finding
//     of the same bug; spike-3 ordered it fixed in 2026-07-23 and only half landed.
//     TTS still bills for `lib/render/` (E-21 renditions, E-33/E-37 phrase renders),
//     so this half of the file stands whatever the tutor's transport is.
//
// The expectations below come from the FIXTURE — the published prices, the spikes'
// own `usage` tables, and this revision's own live runs — never from the artifact
// under test.

// ── measured ground truth ────────────────────────────────────────────────────

/** spike-6 §5.4, published per-1M prices, retrieved 2026-07-25. */
const PUBLISHED_REALTIME = {
  "gpt-realtime-2.1": { audioIn: 32, cachedAudioIn: 0.4, textIn: 4, cachedTextIn: 0.4, textOut: 24, audioOut: 64 },
  "gpt-realtime-2.1-mini": { audioIn: 10, cachedAudioIn: 0.3, textIn: 0.6, cachedTextIn: 0.06, textOut: 2.4, audioOut: 20 },
} as const;

/** spike-6 §5.4: 10.47 audio-input tokens/second = 628/audio-minute, spread 505–665. */
const MEASURED_AUDIO_TOKENS_PER_MIN = 628;
const MEASURED_AUDIO_SPREAD_MAX = 665;

/**
 * spike-6 §5.4's modelled 10-minute conversation, broken into the legs it names:
 * 5 min of learner audio = 3 140 audio-in tokens at the measured 628/min; ~120 output
 * tokens per turn including reasoning over 20 turns; and the §5.5 cache table, whose
 * six measured turns (1 664 + 1 856 + 2 048 + 2 112 + 2 240 = 9 920 cached tokens
 * across 5 turns ⇒ ~1 984/turn, growing) scale to ~140 000 over 20 turns.
 */
const MEASURED_10MIN = {
  audioInTokens: 3140,
  textOutTokens: 20 * 120,
  cachedTokens: 140_000,
  /** The spike's own headline total for the listening leg. */
  listeningLegUsd: 0.2075,
} as const;

/**
 * AUDIO-OUTPUT throughput — the leg the text-out rebuild deleted, and the number two
 * sources disagreed about by 2×.
 *
 * spike-7 §5.2 derived 20.00 tok/s (1 200 per audio-minute) from `usage` across ten
 * voices; a money review of this branch measured 9.93 tok/s and proposed booking 700
 * per elapsed minute. So it was measured again on the shipping configuration —
 * `gpt-realtime-2.1`, `output_modalities: ["audio"]`, the real persona, nine labelled
 * spike-6 fixtures. Every turn that completed returned EXACTLY 20.0 tokens per second
 * of speech. These are the raw pairs; the constant is derived from them here rather
 * than restated, so a fixture typo cannot quietly agree with a wrong constant.
 */
const MEASURED_AUDIO_OUT_TURNS = [
  { label: "G1", audioTokens: 86, seconds: 4.3 },
  { label: "G2", audioTokens: 104, seconds: 5.2 },
  { label: "G3", audioTokens: 389, seconds: 19.45 },
  { label: "G4", audioTokens: 106, seconds: 5.3 },
  { label: "P2", audioTokens: 264, seconds: 13.2 },
  { label: "C1", audioTokens: 102, seconds: 5.1 },
  { label: "C2", audioTokens: 95, seconds: 4.75 },
] as const;

/**
 * spike-7 §5.3's modelled 10-minute AUDIO-OUT conversation, per model — the same
 * assumptions for both, so the ratio between them is meaningful even where the
 * absolute numbers rest on a model. These are what the band below is measured against.
 */
const SPIKE7_10MIN_AUDIO_OUT = {
  "gpt-realtime-2.1": { totalUsd: 0.83, audioOutUsd: 0.3818, textOutUsd: 0.108, inputUsd: 0.3398 },
  "gpt-realtime-2.1-mini": { totalUsd: 0.227, audioOutUsd: 0.1193, textOutUsd: 0.0108, inputUsd: 0.0968 },
} as const;

/** The widest over-book this table is allowed to sit at. Over-booking is the safe
 *  direction; 5.1× is what "safe" degenerates into when nothing bounds it. */
const MAX_OVER_BOOK = 2.5;

/** spike-5 §2.2: the same 92-character sentence, five voices, MEASURED durations. */
const TTS_SAMPLES = [
  { voice: "marin", chars: 92, seconds: 5.448, bytes: 87_168 },
  { voice: "nova", chars: 92, seconds: 6.12, bytes: 97_920 },
  { voice: "alloy-instructed", chars: 92, seconds: 7.056, bytes: 112_896 },
  { voice: "coral", chars: 92, seconds: 7.656, bytes: 122_496 },
  { voice: "alloy-plain", chars: 92, seconds: 7.752, bytes: 124_032 },
] as const;

const perMillion = (usdPerToken: number) => usdPerToken * 1_000_000;

// ── the realtime listening leg ───────────────────────────────────────────────

describe("REALTIME_RATES carries every leg the tutor actually bills", () => {
  it("prices each published per-token rate at or above what OpenAI charges", () => {
    for (const [model, p] of Object.entries(PUBLISHED_REALTIME)) {
      const r = REALTIME_RATES[model as keyof typeof PUBLISHED_REALTIME];
      expect(perMillion(r.usdPerAudioInputToken)).toBeGreaterThanOrEqual(p.audioIn);
      expect(perMillion(r.usdPerCachedAudioInputToken)).toBeGreaterThanOrEqual(p.cachedAudioIn);
      expect(perMillion(r.usdPerTextInputToken)).toBeGreaterThanOrEqual(p.textIn);
      expect(perMillion(r.usdPerCachedTextInputToken)).toBeGreaterThanOrEqual(p.cachedTextIn);
      expect(perMillion(r.usdPerTextOutputToken)).toBeGreaterThanOrEqual(p.textOut);
      expect(perMillion(r.usdPerAudioOutputToken)).toBeGreaterThanOrEqual(p.audioOut);
    }
  });

  it("has a TEXT-OUTPUT rate at all — the leg the old table did not model", () => {
    // Reasoning and the reply's own transcript bill as text even under audio-out —
    // this revision measured 163–365 text-output tokens per turn alongside the audio.
    // A table without this rate prices part of every answer at zero.
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      expect(REALTIME_RATES[model].usdPerTextOutputToken).toBeGreaterThan(0);
      expect(REALTIME_RATES[model].usdPerTextInputToken).toBeGreaterThan(0);
    }
  });

  it("charges EVERY leg, so no direction of transport change can zero one out", () => {
    // The generalisation of both shipped defects. E-34 priced text at $0; the text-out
    // rebuild priced audio-out at $0. Each was correct for its transport and wrong the
    // moment the transport moved. A leg priced at zero is the failure mode, whichever
    // leg it is.
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      for (const [leg, usd] of Object.entries(REALTIME_RATES[model])) {
        expect(usd, `${model}.${leg} must not be free`).toBeGreaterThan(0);
      }
    }
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      const b = realtimeCostBreakdown(model, 10);
      for (const [leg, usd] of Object.entries(b)) {
        if (!leg.endsWith("Usd")) continue;
        expect(usd as number, `${model} breakdown.${leg} must not be free`).toBeGreaterThan(0);
      }
    }
  });

  it("prices the flagship text output at $24/1M, not the superseded $16", () => {
    // spike-6 §5.4 flags this trap explicitly: the older `gpt-realtime` model page
    // still shows $16/1M, which is 1.5× UNDER for `gpt-realtime-2.1`.
    expect(perMillion(REALTIME_RATES[REALTIME_FLAGSHIP].usdPerTextOutputToken)).toBeGreaterThanOrEqual(24);
  });

  it("never prices a cached rate above the uncached rate it discounts", () => {
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      const r = REALTIME_RATES[model];
      expect(r.usdPerCachedAudioInputToken).toBeLessThan(r.usdPerAudioInputToken);
      expect(r.usdPerCachedTextInputToken).toBeLessThan(r.usdPerTextInputToken);
    }
  });
});

describe("the modelled persona bounds the persona actually sent", () => {
  /** The largest persona `buildTutorSessionConfig` can produce: the longest register,
   *  a profile block at its own hard cap, and both bounded lists full. */
  function biggestPersona(): string {
    return REGISTERS.map((r) =>
      buildTutorPersona({
        register: r,
        targetLanguage: "Italian",
        nativeLanguage: "English",
        profileLines: ["x".repeat(PROFILE_MAX_CHARS)],
        slipTargets: Array.from({ length: 5 }, () => "y".repeat(160)),
        todayTargets: Array.from({ length: 8 }, () => "z".repeat(160)),
      }),
    ).sort((a, b) => b.length - a.length)[0];
  }

  it("books at least the real worst-case persona, so growing it goes red here", () => {
    expect(REALTIME_SESSION_PROMPT_TOKENS).toBeGreaterThanOrEqual(estimateTokens(biggestPersona()));
  });

  it("measures the thing it claims to measure", () => {
    // Guards the assertion above against a persona builder that silently returns
    // something tiny: the expectation comes from the fixture, and the fixture must be
    // the real, large prompt.
    expect(biggestPersona().length).toBeGreaterThan(9_000);
  });
});

describe("the realtime cost model is a floor over spike-6's measured legs", () => {
  const r = REALTIME_RATES[REALTIME_FLAGSHIP];

  it("books audio input above the MAXIMUM of the measured spread, not its mean", () => {
    expect(REALTIME_AUDIO_TOKENS_PER_MINUTE).toBeGreaterThan(MEASURED_AUDIO_SPREAD_MAX);
    expect(MEASURED_AUDIO_SPREAD_MAX).toBeGreaterThan(MEASURED_AUDIO_TOKENS_PER_MIN); // the spread is real
  });

  it("covers the measured AUDIO-INPUT leg of a 10-minute conversation", () => {
    const measured = MEASURED_10MIN.audioInTokens * r.usdPerAudioInputToken;
    expect(realtimeCostBreakdown(REALTIME_FLAGSHIP, 10).audioInUsd).toBeGreaterThanOrEqual(measured);
  });

  it("covers the measured TEXT-OUTPUT leg of a 10-minute conversation", () => {
    const measured = MEASURED_10MIN.textOutTokens * r.usdPerTextOutputToken;
    expect(realtimeCostBreakdown(REALTIME_FLAGSHIP, 10).textOutUsd).toBeGreaterThanOrEqual(measured);
    // …and the per-minute constant itself clears the observed rate with margin.
    expect(REALTIME_TEXT_OUTPUT_TOKENS_PER_MINUTE).toBeGreaterThan(MEASURED_10MIN.textOutTokens / 10);
  });

  it("covers the measured CACHED re-send leg, which grows with the conversation", () => {
    const measured = MEASURED_10MIN.cachedTokens * r.usdPerCachedTextInputToken;
    expect(realtimeCostBreakdown(REALTIME_FLAGSHIP, 10).cachedInUsd).toBeGreaterThanOrEqual(measured);
    // The re-send is quadratic in turns, so a LINEAR model that fits at 10 minutes
    // under-books a long call. Tripling the length must more than triple this leg.
    const ten = realtimeCostBreakdown(REALTIME_FLAGSHIP, 10).cachedInUsd;
    const thirty = realtimeCostBreakdown(REALTIME_FLAGSHIP, 30).cachedInUsd;
    expect(thirty).toBeGreaterThan(ten * 3);
  });

  it("covers the measured listening leg END TO END, at every plausible length", () => {
    // spike-6 measures $0.2075 for 10 minutes. Scaled linearly this is a conservative
    // reading of the measurement (the real curve is slightly super-linear in the
    // cached leg, which the assertion above pins separately).
    for (const minutes of [0.25, 0.5, 1, 2, 5, 10, 15, 21, 30]) {
      const measured = MEASURED_10MIN.listeningLegUsd * (minutes / 10);
      expect(realtimeSessionCost(REALTIME_FLAGSHIP, minutes)).toBeGreaterThanOrEqual(measured);
    }
  });

  it("does not collapse on a SHORT call — the case a per-minute rate gets wrong", () => {
    // spike-6's general lesson: "a per-minute rate is not a safe floor for short
    // calls, because the prompt is re-sent every call and a per-minute model charges
    // nothing for it." A 20-second session still sends the whole persona and takes at
    // least one turn, so it must cost at least that much.
    const personaAlone = REALTIME_SESSION_PROMPT_TOKENS * r.usdPerTextInputToken;
    const oneTurnOut = 120 * r.usdPerTextOutputToken;
    expect(realtimeSessionCost(REALTIME_FLAGSHIP, 20 / 60)).toBeGreaterThan(personaAlone + oneTurnOut);
  });

  it("derives the audio-output throughput from `usage`, at 20 tokens per second", () => {
    // The fixture speaks first: every measured turn is exactly 20.0 tok/s, which is
    // what settles spike-7 (20.00) against the review's 9.93. If a future measurement
    // disagrees, this is the line that has to change, and it changes with data.
    for (const t of MEASURED_AUDIO_OUT_TURNS) {
      expect(t.audioTokens / t.seconds, `${t.label}`).toBeCloseTo(20.0, 1);
    }
  });

  it("books audio OUTPUT above the measured rate — the leg the text-out table deleted", () => {
    // ⚠️ This assertion REPLACES one that asserted the opposite ("no longer charges for
    // audio output that is never generated"). Under `output_modalities: ["audio"]` the
    // audio IS generated and is the single largest leg of a conversation, so pricing it
    // at zero is a straight under-book — the one direction that makes the cap a lie.
    const measuredPerAudioMinute = Math.max(...MEASURED_AUDIO_OUT_TURNS.map((t) => (t.audioTokens / t.seconds) * 60));
    expect(REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE).toBeGreaterThan(measuredPerAudioMinute);

    // And a real turn can be most of its minute: the longest measured reply ran 19.45 s
    // to a 5.15 s learner turn, so a constant that assumes the tutor speaks half the
    // time under-books that minute outright.
    const longest = MEASURED_AUDIO_OUT_TURNS.reduce((a, b) => (a.seconds > b.seconds ? a : b));
    const tokensInThatMinute = (longest.audioTokens / longest.seconds) * 60 * (longest.seconds / (longest.seconds + 5.15));
    expect(REALTIME_AUDIO_OUTPUT_TOKENS_PER_MINUTE).toBeGreaterThan(tokensInThatMinute);
  });

  it("covers spike-7's modelled AUDIO-OUTPUT leg for both models", () => {
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      expect(realtimeCostBreakdown(model, 10).audioOutUsd).toBeGreaterThanOrEqual(
        SPIKE7_10MIN_AUDIO_OUT[model].audioOutUsd,
      );
    }
  });

  it("stays within a stated, bounded over-book of measured reality — BOTH models", () => {
    // Over-booking is safe, but "safe" is not a licence for any number: a cap that
    // fires 5× early is a cap that lies in the generous direction, and that is what the
    // E-34 table did (5.1×). This pins the modelled/measured ratio into a BAND so both
    // directions of drift are caught, and it is applied to mini as well — an operator
    // choosing mini for its price is exactly who an unbounded over-book would hurt.
    //
    // Currently flagship 1.95×, mini 2.35×. Widening this bound takes a deliberate edit
    // and a stated reason, rather than one constant drifting at a time.
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      const ratio = realtimeSessionCost(model, 10) / SPIKE7_10MIN_AUDIO_OUT[model].totalUsd;
      expect(ratio, `${model} must never under-book`).toBeGreaterThan(1);
      expect(ratio, `${model} must never become a 5.1×-style fiction`).toBeLessThan(MAX_OVER_BOOK);
    }
  });

  it("keeps mini genuinely cheaper, so the Settings choice means what it says", () => {
    // The tier dial is offered on price. If the model priced them alike the dial would
    // be a lie in the other direction.
    expect(realtimeSessionCost(REALTIME_MINI, 10)).toBeLessThan(realtimeSessionCost(REALTIME_FLAGSHIP, 10) / 2);
  });
});

// ── the TTS speaking leg ─────────────────────────────────────────────────────

describe("TTS is priced per audio-output token, not per character", () => {
  it("bills the real unit and never prices a leg at zero", () => {
    const r = TTS_RATES[TTS_MODEL];
    expect(perMillion(r.usdPerAudioOutputToken)).toBeGreaterThanOrEqual(12);
    expect(perMillion(r.usdPerTextInputToken)).toBeGreaterThanOrEqual(0.6);
    expect(ttsCallCost(TTS_MODEL, 1)).toBeGreaterThan(0);
  });

  it("books a duration per character above the SLOWEST voice measured", () => {
    // A per-character model cannot express that speaking rate is a property of the
    // VOICE — the same 92 characters run 5.448 s to 7.752 s, a 1.42× spread. So the
    // pre-call bound has to clear the slowest one, or the estimate is optimistic for
    // exactly the voice a learner might have chosen.
    const slowest = Math.max(...TTS_SAMPLES.map((s) => s.seconds / s.chars));
    expect(TTS_AUDIO_SECONDS_PER_CHARACTER).toBeGreaterThan(slowest);
  });

  it("covers every measured sample's real cost from its real duration", () => {
    for (const sample of TTS_SAMPLES) {
      const truth = sample.seconds * TTS_AUDIO_TOKENS_PER_SECOND * TTS_RATES[TTS_MODEL].usdPerAudioOutputToken;
      expect(ttsCallCost(TTS_MODEL, sample.chars)).toBeGreaterThanOrEqual(truth);
    }
  });

  it("prices at least twice the per-character rate it replaces — the measured 1.23×–1.76× gap", () => {
    // spike-5 §5.3's prescription: "raise the constant to at least 24/1M (≥2× over the
    // worst measured 1.76×)". Asserted as an effective rate, so a future refactor of
    // the shape cannot quietly lose it.
    const OLD_PER_CHARACTER = 12 / 1_000_000;
    const effective = ttsCallCost(TTS_MODEL, 10_000) / 10_000;
    expect(effective).toBeGreaterThanOrEqual(2 * OLD_PER_CHARACTER);
  });

  it("derives duration from bytes exactly, on every measured sample", () => {
    // Every spike-5 sample divides to exactly 16 000 B/s (128 kbps CBR), which is what
    // makes the honest post-call charge free — no ffprobe, no `usage` object.
    for (const sample of TTS_SAMPLES) {
      expect(sample.bytes / sample.seconds).toBeCloseTo(TTS_MP3_BYTES_PER_SECOND, 6);
      expect(ttsAudioSecondsFromMp3Bytes(sample.bytes)).toBeCloseTo(sample.seconds, 6);
    }
  });

  it("charges the honest duration-based cost, and never more than the pre-call bound", () => {
    for (const sample of TTS_SAMPLES) {
      const honest = ttsCostFromAudioSeconds(TTS_MODEL, sample.seconds, sample.chars);
      expect(honest).toBeLessThanOrEqual(ttsCallCost(TTS_MODEL, sample.chars));
      expect(honest).toBeGreaterThan(0);
    }
  });

  it("covers the TTS leg of a 10-minute conversation (spike-6: 5 min of tutor speech)", () => {
    // 5 minutes of speech at the documented $0.015/audio-minute is $0.075.
    const measured = 0.075;
    const chars = Math.ceil((5 * 60) / TTS_AUDIO_SECONDS_PER_CHARACTER);
    expect(ttsCallCost(TTS_MODEL, chars)).toBeGreaterThanOrEqual(measured);
  });
});
