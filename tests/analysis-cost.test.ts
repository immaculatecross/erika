import { describe, expect, it } from "vitest";
import { estimateCost } from "@/lib/analysis/cost";
import { MINI_MODEL, DEEP_MODELS, textCallOverhead, usdPerAudioMinute } from "@/lib/analysis/rates";

// Criterion 5 — the pre-run cost estimate is a pure function of segment
// durations and the rates table, and matches the hand-computed figure. Cached
// segments are excluded by the caller (here: absent from the pending list).
//
// [E-42 criterion 13] A call now costs audio-per-minute PLUS a fixed text charge
// for the prompt going up and the JSON coming back, so these hand-computations
// carry a per-CALL term as well as a per-minute one. That is the whole point of the
// change: the deep prompt is ~2,600 tokens and is re-sent on every call, so a run of
// many short segments is far more expensive than minutes alone suggest.

const miniRate = usdPerAudioMinute(MINI_MODEL);
const deepRate = usdPerAudioMinute(DEEP_MODELS[0]);
const miniText = textCallOverhead(MINI_MODEL);
const deepText = textCallOverhead(DEEP_MODELS[0]);

describe("cost estimate", () => {
  it("prices mini over compressed renditions plus expected deep at native speed", () => {
    // Two segments: 60s and 120s (1 and 2 audio-minutes). tempo 1.5, flagRate 0.5.
    const est = estimateCost(
      [{ durationMs: 60_000 }, { durationMs: 120_000 }],
      { tempo: 1.5, flagRate: 0.5 },
    );
    const totalMinutes = 3;
    const expectedMini = (totalMinutes / 1.5) * miniRate + 2 * miniText; // two triage calls
    const expectedDeep = 0.5 * (totalMinutes * deepRate + 2 * deepText); // two deep calls, half expected
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

  // [E-42 criterion 13] The defect, stated as a test: two runs over the SAME total
  // audio cost different amounts when one is split into more segments, because each
  // segment is another full prompt. Priced per-minute only, these were identical and
  // the extra prompts were free — which is exactly how ~129k prompt tokens a day dump
  // vanished from the ledger.
  it("prices the prompt on every call, so more segments cost more than the same minutes in one", () => {
    const oneLong = estimateCost([{ durationMs: 600_000 }], { tempo: 1.5, flagRate: 1 });
    const tenShort = estimateCost(
      Array.from({ length: 10 }, () => ({ durationMs: 60_000 })),
      { tempo: 1.5, flagRate: 1 },
    );
    expect(tenShort.totalUsd).toBeGreaterThan(oneLong.totalUsd);
    // And by exactly the nine extra prompts, not by some vaguer amount.
    expect(tenShort.totalUsd - oneLong.totalUsd).toBeCloseTo(9 * (miniText + deepText), 9);
  });

  // The floor that matters: no call may ever be modelled at zero text cost.
  it("charges text on every model, mini included", () => {
    expect(miniText).toBeGreaterThan(0);
    expect(deepText).toBeGreaterThan(0);
  });
});
