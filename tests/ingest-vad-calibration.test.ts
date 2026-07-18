import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  detectSpeech,
  MAX_THRESHOLD_DB,
  measureNoiseFloorDb,
  MIN_THRESHOLD_DB,
  parseNoiseFloor,
  speechThresholdDb,
  type Interval,
} from "@/lib/ingest/vad";

// E-16b criterion 3, under mfactory D-13: a synthetic tone-vs-silence fixture
// proves the VAD mechanism but cannot falsify a threshold — a full-scale tone
// over digital silence is found by any parameters at all. So calibration is
// asserted against a committed, LABELLED speech sample (quiet amplitude-modulated
// utterances over a real pink-noise floor; see fixtures/make-labelled-speech.sh)
// and the metric is RECALL of the labelled spans: what fraction of the speech the
// user actually produced survives into the segments the model gets to hear.
//
// The sample is genuinely falsifying — the pre-E-16b parameters score 0.515 on it.

const FIXTURES = path.join(__dirname, "fixtures");
const SAMPLE = path.join(FIXTURES, "labelled-speech.flac");
const LABELS = JSON.parse(fs.readFileSync(path.join(FIXTURES, "labelled-speech.json"), "utf8")) as {
  totalMs: number;
  speech: Interval[];
};

/** Fraction of labelled speech milliseconds covered by the detected intervals. */
function recall(detected: Interval[], labelled: Interval[]): number {
  let covered = 0;
  let total = 0;
  for (const span of labelled) {
    total += span.endMs - span.startMs;
    for (const iv of detected) {
      const overlap = Math.min(span.endMs, iv.endMs) - Math.max(span.startMs, iv.startMs);
      if (overlap > 0) covered += overlap;
    }
  }
  return total === 0 ? 1 : covered / total;
}

const keptMs = (ivs: Interval[]) => ivs.reduce((n, iv) => n + (iv.endMs - iv.startMs), 0);

const SLOW = 60_000;

describe("noise floor measurement", () => {
  it("parses the overall floor, preferring the last (overall) block", () => {
    expect(
      parseNoiseFloor(
        ["Noise floor dB: -40.5", "Noise floor count: 12", "Noise floor dB: -59.938455"].join("\n"),
      ),
    ).toBeCloseTo(-59.938455, 5);
  });

  it("reads digital silence's -inf rather than a bogus number", () => {
    expect(parseNoiseFloor("Noise floor dB: -inf")).toBe(-Infinity);
    expect(parseNoiseFloor("nothing here")).toBeNaN();
  });

  it("measures the sample's own floor well below the old fixed -30 dB", async () => {
    const floor = await measureNoiseFloorDb(SAMPLE);
    expect(floor).toBeLessThan(-50);
    expect(floor).toBeGreaterThan(-70);
  }, SLOW);
});

describe("speechThresholdDb", () => {
  it("sits a fixed margin above the measured floor", () => {
    expect(speechThresholdDb(-60)).toBe(-48);
    expect(speechThresholdDb(-50)).toBe(-38);
  });

  it("never becomes more aggressive than the old fixed floor", () => {
    // A loud room must not let the threshold climb into the speech itself.
    expect(speechThresholdDb(-10)).toBe(MAX_THRESHOLD_DB);
  });

  it("falls back to the conservative bound when the floor is unmeasurable", () => {
    // Digital silence (the tone fixtures) and a silent astats both land here.
    expect(speechThresholdDb(-Infinity)).toBe(MIN_THRESHOLD_DB);
    expect(speechThresholdDb(Number.NaN)).toBe(MIN_THRESHOLD_DB);
    expect(speechThresholdDb(-90)).toBe(MIN_THRESHOLD_DB);
  });
});

describe("labelled-sample recall (D-13 calibration)", () => {
  it("keeps essentially all of the labelled speech", async () => {
    const detected = await detectSpeech(SAMPLE);
    const score = recall(detected, LABELS.speech);
    expect(score).toBeGreaterThanOrEqual(0.95);

    // Recall is not bought by keeping the whole file: VAD must still discard the
    // room tone, or D-10's cost architecture is gone. 17 s in, ~13 s kept.
    expect(keptMs(detected)).toBeLessThan(LABELS.totalMs * 0.85);
  }, SLOW);

  it("is a threshold the PREVIOUS parameters fail — the sample can falsify", async () => {
    // Exactly the pre-E-16b configuration: a fixed -30 dBFS floor, no padding, a
    // 300 ms merge gap, a 2 s minimum. If this ever also scored ≥ 0.95 the
    // fixture would be proving nothing (D-13's point about tone fixtures).
    const before = await detectSpeech(SAMPLE, {
      thresholdDb: -30,
      padMs: 0,
      mergeGapMs: 300,
      minSegmentMs: 2000,
    });
    expect(recall(before, LABELS.speech)).toBeLessThan(0.7);
  }, SLOW);
});
