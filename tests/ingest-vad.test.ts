import { describe, expect, it } from "vitest";
import { parseSilences, speechIntervals } from "@/lib/ingest/vad";
import {
  DEFAULT_TRIAGE_TEMPO,
  MAX_TRIAGE_TEMPO,
  MIN_TRIAGE_TEMPO,
  TempoError,
  triageTempo,
} from "@/lib/ingest/render";

// Pure interval math and config validation — no ffmpeg, fast. The end-to-end
// ffmpeg behavior is exercised in ingest-pipeline.test.ts.

describe("parseSilences", () => {
  it("pairs silence_start/end lines into ms windows", () => {
    const stderr = [
      "[silencedetect @ 0x0] silence_start: 1.999938",
      "[silencedetect @ 0x0] silence_end: 5.000125 | silence_duration: 3.0",
    ].join("\n");
    expect(parseSilences(stderr, 9000)).toEqual([{ startMs: 2000, endMs: 5000 }]);
  });

  it("closes a trailing silence_start at the total duration", () => {
    const stderr = "[silencedetect @ 0x0] silence_start: 7.0";
    expect(parseSilences(stderr, 9000)).toEqual([{ startMs: 7000, endMs: 9000 }]);
  });
});

describe("speechIntervals (criteria 2 & 3 logic)", () => {
  it("inverts silence into the surrounding speech intervals", () => {
    // [2s tone][3s silence][4s tone] → speech [0,2] and [5,9].
    const out = speechIntervals([{ startMs: 2000, endMs: 5000 }], 9000);
    expect(out).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 9000 },
    ]);
  });

  it("drops sub-2s intervals (1s kept-out, 5s kept-in)", () => {
    // [1s tone][3s silence][5s tone] → only the 5s interval survives.
    const out = speechIntervals([{ startMs: 1000, endMs: 4000 }], 9000);
    expect(out).toEqual([{ startMs: 4000, endMs: 9000 }]);
  });

  it("merges speech split by a gap ≤ mergeGapMs into one interval", () => {
    const out = speechIntervals(
      [
        { startMs: 3000, endMs: 3200 }, // 200 ms gap — below the 300 ms merge threshold
      ],
      9000,
    );
    expect(out).toEqual([{ startMs: 0, endMs: 9000 }]);
  });

  it("whole-file speech when there is no silence", () => {
    expect(speechIntervals([], 5000)).toEqual([{ startMs: 0, endMs: 5000 }]);
  });

  it("clamps silence bounds to [0, total]", () => {
    const out = speechIntervals([{ startMs: -500, endMs: 3000 }], 8000);
    expect(out).toEqual([{ startMs: 3000, endMs: 8000 }]);
  });
});

describe("triageTempo (criterion 6 validation)", () => {
  it("defaults to 1.5 when unset", () => {
    expect(triageTempo(undefined)).toBe(DEFAULT_TRIAGE_TEMPO);
  });

  it("accepts values in the allowed range", () => {
    expect(triageTempo(MIN_TRIAGE_TEMPO)).toBe(1.25);
    expect(triageTempo(MAX_TRIAGE_TEMPO)).toBe(1.5);
    expect(triageTempo("1.35")).toBe(1.35);
  });

  it("rejects out-of-range or non-numeric tempo truthfully", () => {
    expect(() => triageTempo(2)).toThrow(TempoError);
    expect(() => triageTempo(1.0)).toThrow(TempoError);
    expect(() => triageTempo("fast")).toThrow(TempoError);
  });
});
