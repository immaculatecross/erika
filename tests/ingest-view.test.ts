import { describe, expect, it } from "vitest";
import { formatSpan, summarizeSpeech } from "@/lib/ingest-view";

// Pure view-model helpers for the ingest UI (E-3 part 2 criterion 2): the
// raw-vs-speech summary and its labels must be correct across the h/m/s
// boundaries — this is the test the criterion demands.

describe("formatSpan", () => {
  it("shows the two most significant units across boundaries", () => {
    expect(formatSpan(6 * 3600_000 + 2 * 60_000)).toBe("6h 2m"); // 6h 2m
    expect(formatSpan(47 * 60_000 + 3_000)).toBe("47m 3s"); // 47m 3s
    expect(formatSpan(12_000)).toBe("12s"); // 12s
  });

  it("drops a zero lesser unit rather than printing it", () => {
    expect(formatSpan(2 * 3600_000)).toBe("2h"); // exactly 2h → no minutes
    expect(formatSpan(5 * 60_000)).toBe("5m"); // exactly 5m → no seconds
  });

  it("rounds sub-second and clamps negatives to 0s", () => {
    expect(formatSpan(400)).toBe("0s");
    expect(formatSpan(-1000)).toBe("0s");
    expect(formatSpan(900)).toBe("1s"); // rounds to the nearest second
  });
});

describe("summarizeSpeech", () => {
  it("sums segment durations against the raw seconds and derives the share", () => {
    // Raw 6h 2m; speech 47m across three segments.
    const raw = 6 * 3600 + 2 * 60; // seconds
    const segments = [
      { durationMs: 20 * 60_000 },
      { durationMs: 20 * 60_000 },
      { durationMs: 7 * 60_000 },
    ];
    const s = summarizeSpeech(segments, raw);
    expect(s.rawMs).toBe(raw * 1000);
    expect(s.speechMs).toBe(47 * 60_000);
    expect(s.segmentCount).toBe(3);
    expect(s.rawLabel).toBe("6h 2m");
    expect(s.speechLabel).toBe("47m");
    expect(s.speechPercent).toBe(13); // round(47 / 362 * 100)
  });

  it("reports zero speech and no divide-by-zero on an empty recording", () => {
    const s = summarizeSpeech([], 0);
    expect(s.speechMs).toBe(0);
    expect(s.segmentCount).toBe(0);
    expect(s.speechPercent).toBe(0);
    expect(s.speechLabel).toBe("0s");
  });
});
