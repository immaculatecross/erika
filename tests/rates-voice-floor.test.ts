import { describe, expect, it } from "vitest";
import { REGISTERS } from "@/lib/register";
import { PROFILE_MAX_CHARS } from "@/lib/analysis/profile";
import { buildTutorPersona } from "@/lib/tutor/persona";
import {
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
// Two independent defects are guarded here, both of which shipped:
//
//   * `REALTIME_RATES` had NO text-token rates at all, and `realtimePerMinuteUsd`
//     charged 1500 audio-OUTPUT tokens/minute at $64/1M for audio that, under
//     `output_modalities: ["text"]`, is never generated. Measured: $1.44 modelled
//     against $0.283 real — a 5.1× OVER-book (spike-6 §5.6). Safe direction, but
//     large enough to refuse a learner who has budget.
//   * `TTS_RATES` billed per input CHARACTER at the audio-output-token rate:
//     1.23×–1.76× UNDER, voice-dependent (spike-5 §5.3). Third independent finding
//     of the same bug; spike-3 ordered it fixed in 2026-07-23 and only half landed.
//
// The expectations below come from the FIXTURE — the published prices and the spikes'
// own `usage` tables — never from the artifact under test.

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
    // Under D-28 the reply IS text, so this is the dominant output cost. A table
    // without it prices the tutor's whole answer at zero.
    for (const model of [REALTIME_FLAGSHIP, REALTIME_MINI] as const) {
      expect(REALTIME_RATES[model].usdPerTextOutputToken).toBeGreaterThan(0);
      expect(REALTIME_RATES[model].usdPerTextInputToken).toBeGreaterThan(0);
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

  it("no longer charges for audio output that is never generated", () => {
    // The 5.1× over-book, as a permanent guard. The old model booked 1500 audio-out
    // tokens per minute at $64/1M = $0.096/min = $0.96 on this leg alone for 10
    // minutes; under D-28 no audio output exists, so the whole session must cost less
    // than that phantom leg did.
    const phantomAudioOutLeg = 10 * 1500 * r.usdPerAudioOutputToken;
    expect(realtimeSessionCost(REALTIME_FLAGSHIP, 10)).toBeLessThan(phantomAudioOutLeg);
  });

  it("stays within a stated, bounded over-book of measured reality", () => {
    // Over-booking is safe, but "safe" is not a licence for any number: a cap that
    // fires 5× early is a cap that lies in the generous direction, and that is what
    // the old table did (5.1×). This pins the modelled/measured ratio into a BAND, so
    // both directions of drift are caught.
    //
    // It currently sits at **2.47×**, and the upper bound is deliberately just above
    // it: every leg is individually ~2–2.5× its measured mean because each constant
    // clears a measured MAXIMUM (and the audio leg books every elapsed minute as
    // speech, which is the honest bound since the server cannot know the split). The
    // tightness is the point — like the mint allowlist, widening this takes a
    // deliberate edit and a stated reason, rather than drifting one constant at a time.
    const ratio = realtimeSessionCost(REALTIME_FLAGSHIP, 10) / MEASURED_10MIN.listeningLegUsd;
    expect(ratio).toBeGreaterThan(1); // never under
    expect(ratio).toBeLessThan(2.5); // and never a 5.1×-style fiction
  });

  it("prices mini above its own measured leg too, so an env override is not free", () => {
    expect(realtimeSessionCost(REALTIME_MINI, 10)).toBeGreaterThanOrEqual(0.0446);
    expect(realtimeSessionCost(REALTIME_MINI, 10)).toBeLessThan(realtimeSessionCost(REALTIME_FLAGSHIP, 10));
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
