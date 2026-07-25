import { describe, expect, it } from "vitest";
import { deepPrompt, triagePrompt } from "@/lib/analysis/prompts";
import { DEEP_MAX_OUTPUT_TOKENS, TRIAGE_MAX_OUTPUT_TOKENS } from "@/lib/analysis/audio-model";
import {
  PROFILE_FIELD_MAX_CHARS,
  PROFILE_MAX_CHARS,
  PROFILE_MAX_ENTRIES,
  type SpeakerProfile,
} from "@/lib/analysis/profile";
import { CATEGORIES } from "@/lib/analysis/findings";
import { REGISTERS } from "@/lib/register";
import {
  AUDIO_TOKENS_PER_MINUTE,
  DEEP_MODELS,
  MINI_MODEL,
  RATES,
  callCost,
  estimateTokens,
  textCallOverhead,
  usdPerAudioMinute,
} from "@/lib/analysis/rates";

// THE PROMPT IS NOT FREE (E-42 criterion 13).
//
// `gpt-audio-mini` billed its text tokens at $0 — an audio-input floor with no
// allowance for the prompt going up or the JSON coming back — on the most-used money
// path. E-39 then grew the deep prompt from ~1,900 to 7,392 characters (~1,848
// tokens) when it absorbed `lib/mistakes.ts`, and every one of those tokens is
// re-sent on EVERY deep call. This milestone makes analysis automatic, so the error
// now compounds on every recording without anyone pressing anything.
//
// The structural fix is not the constant, it is THIS FILE: the modelled prompt
// allowance is pinned against the ACTUAL prompt builders, so growing a prompt again
// turns a test red instead of turning the cap into a lie. That is the guard the
// original defect never had — nothing compared the code to the prompt it sends, and
// nothing compared either to `docs/research/`, which had the right figures all along.

/**
 * The worst realistic prompt: the longest register, plus a speaker profile filled to
 * every one of its own caps (PROFILE_MAX_ENTRIES entries at PROFILE_FIELD_MAX_CHARS,
 * every category rate and mastery present). `profileBlock` clips the result to
 * PROFILE_MAX_CHARS, so this is genuinely the largest prompt the app can build.
 */
function biggestDeepPrompt(): string {
  const profile: SpeakerProfile = {
    nativeLanguage: "English",
    entries: Array.from({ length: PROFILE_MAX_ENTRIES }, (_, i) => ({
      id: `R${i + 1}`,
      quote: "y".repeat(PROFILE_FIELD_MAX_CHARS),
      correction: "x".repeat(PROFILE_FIELD_MAX_CHARS),
      category: "grammar" as const,
      count: 3,
    })),
    rates: CATEGORIES.map((category) => ({ category, count: 9, ratePerHour: 9.99 })),
    mastery: CATEGORIES.map((category) => ({ category, mastery: 0.55 })),
  };
  return REGISTERS.map((r) => deepPrompt("Italian", profile, r)).sort((a, b) => b.length - a.length)[0];
}

describe("the modelled prompt allowance bounds the real prompt", () => {
  it("the deep allowance covers the actual deep prompt, profile and all", () => {
    const real = estimateTokens(biggestDeepPrompt());
    expect(RATES[DEEP_MODELS[0]].promptTokens).toBeGreaterThanOrEqual(real);
    // …and the bare prompt is genuinely the size criterion 13 named, so this test is
    // measuring the thing it claims to measure.
    expect(deepPrompt("Italian").length).toBeGreaterThan(7_000);
  });

  it("the triage allowance covers the actual triage prompt plus a capped profile", () => {
    const real = estimateTokens(triagePrompt("Italian")) + estimateTokens("x".repeat(PROFILE_MAX_CHARS));
    expect(RATES[MINI_MODEL].promptTokens).toBeGreaterThanOrEqual(real);
  });

  it("every deep model in the fallback chain is priced, not just the primary", () => {
    // The D-3 fallback carries the same prompt and the same JSON. Pricing only the
    // primary would make a fallback run silently cheaper than it is.
    for (const m of DEEP_MODELS) {
      expect(RATES[m].promptTokens).toBeGreaterThanOrEqual(estimateTokens(biggestDeepPrompt()));
      expect(textCallOverhead(m)).toBeGreaterThan(0);
    }
  });
});

describe("the completion allowance stays inside the ceiling the code enforces", () => {
  it("never books more output than max_completion_tokens could return", () => {
    // Booking beyond the enforced ceiling would not be conservative, it would be
    // fiction — and it would roughly double a day dump's modelled cost.
    for (const m of DEEP_MODELS) {
      expect(RATES[m].completionTokens).toBeLessThanOrEqual(DEEP_MAX_OUTPUT_TOKENS);
    }
    expect(RATES[MINI_MODEL].completionTokens).toBeLessThanOrEqual(TRIAGE_MAX_OUTPUT_TOKENS);
  });
});

describe("the rates are floors over the researched figures", () => {
  // Cross-checked against docs/research/spike-1-speaker-throughput.md and
  // spike-3-extraction-tutor.md, which both carry these rows with citations. Two v0.6
  // money defects were already documented CORRECTLY there before the wrong constant
  // was written, and nothing compared them — so the comparison lives here now.
  const PUBLISHED = {
    "gpt-audio-mini": { audioIn: 10 / 1_000_000, textIn: 0.6 / 1_000_000, textOut: 2.4 / 1_000_000 },
    "gpt-audio-1.5": { audioIn: 32 / 1_000_000, textIn: 2.5 / 1_000_000, textOut: 10 / 1_000_000 },
    "gpt-audio": { audioIn: 32 / 1_000_000, textIn: 2.5 / 1_000_000, textOut: 10 / 1_000_000 },
  } as const;
  const RESEARCHED_AUDIO_TOKENS_PER_MINUTE = 600; // "≈10 tokens/s", both spikes

  it("prices audio at or above the published per-token rate", () => {
    for (const [model, p] of Object.entries(PUBLISHED)) {
      expect(RATES[model as keyof typeof PUBLISHED].usdPerAudioInputToken).toBeGreaterThanOrEqual(p.audioIn);
      expect(usdPerAudioMinute(model as keyof typeof PUBLISHED)).toBeGreaterThanOrEqual(
        RESEARCHED_AUDIO_TOKENS_PER_MINUTE * p.audioIn,
      );
    }
    // Over-booking throughput is the safe direction and is deliberate.
    expect(AUDIO_TOKENS_PER_MINUTE).toBeGreaterThanOrEqual(RESEARCHED_AUDIO_TOKENS_PER_MINUTE);
  });

  it("prices text at or above the published per-token rates", () => {
    for (const [model, p] of Object.entries(PUBLISHED)) {
      const r = RATES[model as keyof typeof PUBLISHED];
      expect(r.usdPerPromptToken).toBeGreaterThanOrEqual(p.textIn);
      expect(r.usdPerCompletionToken).toBeGreaterThanOrEqual(p.textOut);
    }
  });

  it("a whole call costs at least what the research says it costs", () => {
    // The end-to-end floor, hand-computed from the published prices for a realistic
    // deep call: 40 s of audio, a ~2,200-token prompt, a ~600-token reply.
    const p = PUBLISHED["gpt-audio-1.5"];
    const realistic =
      (40 / 60) * RESEARCHED_AUDIO_TOKENS_PER_MINUTE * p.audioIn + 2200 * p.textIn + 600 * p.textOut;
    expect(callCost("gpt-audio-1.5", 40_000)).toBeGreaterThan(realistic);
  });

  it("no model is priced at zero on either leg", () => {
    // The defect, as a permanent guard: a rate table where any leg is free is a cap
    // that lies about that leg.
    for (const m of [MINI_MODEL, ...DEEP_MODELS] as const) {
      expect(RATES[m].usdPerAudioInputToken).toBeGreaterThan(0);
      expect(RATES[m].usdPerPromptToken).toBeGreaterThan(0);
      expect(RATES[m].usdPerCompletionToken).toBeGreaterThan(0);
      expect(callCost(m, 0)).toBeGreaterThan(0); // even a zero-length call sends a prompt
    }
  });
});
