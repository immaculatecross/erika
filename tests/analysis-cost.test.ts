import { describe, expect, it } from "vitest";
import { estimateCost } from "@/lib/analysis/cost";
import { RATES, MINI_MODEL, DEEP_MODELS } from "@/lib/analysis/rates";

// Criterion 5 — the pre-run cost estimate is a pure function of segment
// durations and the rates table, and matches the hand-computed figure. Cached
// segments are excluded by the caller (here: absent from the pending list).

const miniRate = RATES[MINI_MODEL].usdPerAudioMinute;
const deepRate = RATES[DEEP_MODELS[0]].usdPerAudioMinute;

describe("cost estimate", () => {
  it("prices mini over compressed renditions plus expected deep at native speed", () => {
    // Two segments: 60s and 120s (1 and 2 audio-minutes). tempo 1.5, flagRate 0.5.
    const est = estimateCost(
      [{ durationMs: 60_000 }, { durationMs: 120_000 }],
      { tempo: 1.5, flagRate: 0.5 },
    );
    const totalMinutes = 3;
    const expectedMini = (totalMinutes / 1.5) * miniRate;
    const expectedDeep = 0.5 * totalMinutes * deepRate;
    expect(est.pendingCount).toBe(2);
    expect(est.miniUsd).toBeCloseTo(expectedMini, 10);
    expect(est.deepUsd).toBeCloseTo(expectedDeep, 10);
    expect(est.totalUsd).toBeCloseTo(expectedMini + expectedDeep, 10);
  });

  it("is zero when nothing is pending (all cached)", () => {
    const est = estimateCost([], { tempo: 1.5 });
    expect(est).toMatchObject({ pendingCount: 0, miniUsd: 0, deepUsd: 0, totalUsd: 0 });
  });

  it("scales the deep term with the assumed flag rate", () => {
    const base = estimateCost([{ durationMs: 600_000 }], { tempo: 1.5, flagRate: 0.2 });
    const doubled = estimateCost([{ durationMs: 600_000 }], { tempo: 1.5, flagRate: 0.4 });
    expect(doubled.deepUsd).toBeCloseTo(base.deepUsd * 2, 10);
    expect(doubled.miniUsd).toBeCloseTo(base.miniUsd, 10); // mini unaffected by flag rate
  });
});
