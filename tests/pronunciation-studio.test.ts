import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRONUNCIATION_THRESHOLDS,
  pronunciationThresholds,
  scoreBand,
  isTooNoisy,
  UNCALIBRATED_NOTICE,
  TOO_NOISY_NOTICE,
} from "@/lib/pronunciation/thresholds";
import { attemptPassed, buildResultView, phonemeNote, producedInstead } from "@/lib/pronunciation/view";
import { whatToListenFor, UNSCORED_NOTICE } from "@/lib/pronunciation/guidance";
import { fixtureResult } from "@/lib/pronunciation/fixture-scorer";
import type { PronunciationResult } from "@/lib/pronunciation/types";

// E-37 the pure feedback layer: thresholds as CONFIG, the SNR re-record gate, the
// word/phoneme view model, and the qualitative guidance that works with no scorer at
// all. All pure — no DB, no network.

const T = DEFAULT_PRONUNCIATION_THRESHOLDS;

describe("thresholds are tunable config, not magic numbers", () => {
  it("every band comes from env-overridable knobs with documented defaults", () => {
    expect(pronunciationThresholds({})).toEqual(T);
    expect(
      pronunciationThresholds({
        PRON_GOOD_SCORE: "90",
        PRON_SHAKY_SCORE: "70",
        PRON_PASS_SCORE: "95",
        PRON_MIN_SNR_DB: "15",
      }),
    ).toEqual({ good: 90, shaky: 70, pass: 95, minSnrDb: 15 });
  });

  it("a bad env value falls back to the default — a typo can never disable a gate", () => {
    expect(pronunciationThresholds({ PRON_MIN_SNR_DB: "not-a-number" }).minSnrDb).toBe(T.minSnrDb);
    expect(pronunciationThresholds({ PRON_GOOD_SCORE: "" }).good).toBe(T.good);
  });

  it("bands split at the configured marks, and the view carries them for inspection", () => {
    expect(scoreBand(T.good, T)).toBe("good");
    expect(scoreBand(T.good - 1, T)).toBe("shaky");
    expect(scoreBand(T.shaky, T)).toBe("shaky");
    expect(scoreBand(T.shaky - 1, T)).toBe("off");
    expect(buildResultView(fixtureResult("clean"), T).thresholds).toEqual(T);
  });

  it("says plainly that the mapping is our own choice, not a validated measurement", () => {
    // No labelled Italian PA corpus exists, so this can never become "calibrated".
    expect(UNCALIBRATED_NOTICE).toMatch(/Azure's scores/);
    expect(UNCALIBRATED_NOTICE).toMatch(/thresholds are our own/i);
    expect(UNCALIBRATED_NOTICE).toMatch(/no labelled\s+Italian pronunciation corpus/i);
    expect(buildResultView(fixtureResult("clean"), T).notice).toBe(UNCALIBRATED_NOTICE);
  });
});

describe("the SNR gate — a noisy take scores the room, not the learner", () => {
  const noisy = fixtureResult("noisy");

  it("flags a take below the configured SNR floor", () => {
    expect(noisy.snrDb).toBeLessThan(T.minSnrDb);
    expect(isTooNoisy(noisy.snrDb, T)).toBe(true);
    expect(isTooNoisy(fixtureResult("clean").snrDb, T)).toBe(false);
  });

  it("yields the re-record prompt and NO scores at all", () => {
    const view = buildResultView(noisy, T);
    expect(view.retake).toBe(true);
    expect(view.retakeNotice).toBe(TOO_NOISY_NOTICE);
    expect(view.scores).toBeNull();
    expect(view.words).toEqual([]);
    // Not a single number from that take reaches the surface.
    expect(JSON.stringify(view.words)).not.toContain("47");
  });

  it("never passes, however high the numbers look", () => {
    const highButNoisy: PronunciationResult = { ...noisy, pronScore: 99 };
    expect(attemptPassed(highButNoisy, T)).toBe(false);
  });

  it("an ABSENT SNR is not treated as noisy — we do not invent a reason to withhold", () => {
    const noSnr: PronunciationResult = { ...fixtureResult("clean"), snrDb: null };
    expect(isTooNoisy(null, T)).toBe(false);
    expect(buildResultView(noSnr, T).retake).toBe(false);
  });

  it("the floor is tunable: raising it above a clean take's SNR gates that take too", () => {
    const clean = fixtureResult("clean");
    const strict = { ...T, minSnrDb: (clean.snrDb ?? 0) + 1 };
    expect(buildResultView(clean, strict).retake).toBe(true);
  });
});

describe("the word/phoneme view model", () => {
  const view = buildResultView(fixtureResult("gli-gnocchi"), T);

  it("bands each word and converts the 100-ns ticks to millisecond offsets", () => {
    const gli = view.words[0];
    expect(gli.band).toBe("off"); // 38
    expect(gli.startMs).toBe(30); // 300000 ticks
    expect(gli.durationMs).toBe(260); // 2 600 000 ticks
    expect(gli.playable).toBe(true);
    expect(view.words[2].band).toBe("good"); // "sono", 94
  });

  it("names what was produced instead, only when the alternates actually support it", () => {
    const palatal = view.words[0].phonemes[0];
    expect(palatal.producedInstead).toBe("l");
    expect(palatal.note).toBe("You produced /l/ where /ʎ/ was expected.");

    // A phoneme whose top alternate IS the expected one claims no substitution.
    expect(producedInstead({ phoneme: "o", accuracyScore: 93, offsetTicks: 0, durationTicks: 1, nBest: [{ phoneme: "o", score: 93 }] })).toBeNull();
    // Nor does one whose alternate scored no better — that would be an invention.
    expect(
      producedInstead({ phoneme: "r", accuracyScore: 55, offsetTicks: 0, durationTicks: 1, nBest: [{ phoneme: "l", score: 40 }] }),
    ).toBeNull();
  });

  it("stays silent on a phoneme that was fine, and plain when it has no alternate", () => {
    expect(phonemeNote({ phoneme: "s", accuracyScore: 96, offsetTicks: 0, durationTicks: 1, nBest: [] }, T)).toBeNull();
    expect(phonemeNote({ phoneme: "r", accuracyScore: 30, offsetTicks: 0, durationTicks: 1, nBest: [] }, T)).toBe(
      "/r/ came out unclear.",
    );
  });

  it("marks an omitted word unplayable — there is no audio of it to seek to", () => {
    const omitted = buildResultView(fixtureResult("omission"), T).words.find((w) => w.errorType === "Omission")!;
    expect(omitted.playable).toBe(false);
    expect(omitted.phonemes).toEqual([]);
  });

  it("passes a clean take and fails a weak one, at the configured pass mark", () => {
    expect(attemptPassed(fixtureResult("clean"), T)).toBe(true);
    expect(attemptPassed(fixtureResult("gli-gnocchi"), T)).toBe(false); // 77.2 < 80
    expect(attemptPassed(fixtureResult("gli-gnocchi"), { ...T, pass: 70 })).toBe(true);
  });
});

describe("guidance works with no scorer at all — the primary path", () => {
  it("uses the deep pass's flagged suspect as the thing to listen for", () => {
    const g = whatToListenFor({ suspect: "the double t in fatto is not held" });
    expect(g.basis).toBe("flag");
    expect(g.text).toContain("the double t in fatto is not held");
    expect(g.text).toMatch(/say the line back/i);
  });

  it("says something honest and generic when nothing specific was flagged", () => {
    const g = whatToListenFor({ suspect: null });
    expect(g.basis).toBe("general");
    // No invented diagnosis: it must not claim to have noticed anything.
    expect(g.text).not.toMatch(/noticed/i);
  });

  it("states that an unscored take is a comparison, not a measurement", () => {
    expect(UNSCORED_NOTICE).toMatch(/Nothing here is scored/i);
    expect(UNSCORED_NOTICE).toMatch(/will not put a number/i);
  });
});
