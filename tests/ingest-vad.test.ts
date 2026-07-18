import { describe, expect, it } from "vitest";
import {
  MAX_SEGMENT_MS,
  MIN_SEGMENT_MS,
  PAD_MS,
  parseSilences,
  speechIntervals,
} from "@/lib/ingest/vad";
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
  // These cover the interval algebra itself, so they pin padding to 0; the
  // pre/post-roll it adds by default has its own block below.
  const NO_PAD = { padMs: 0 };

  it("inverts silence into the surrounding speech intervals", () => {
    // [2s tone][3s silence][4s tone] → speech [0,2] and [5,9].
    const out = speechIntervals([{ startMs: 2000, endMs: 5000 }], 9000, NO_PAD);
    expect(out).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 5000, endMs: 9000 },
    ]);
  });

  it("drops intervals under the minimum (1s kept-out, 5s kept-in)", () => {
    // [1s tone][3s silence][5s tone] → only the 5s interval survives.
    const out = speechIntervals([{ startMs: 1000, endMs: 4000 }], 9000, NO_PAD);
    expect(out).toEqual([{ startMs: 4000, endMs: 9000 }]);
    expect(1000).toBeLessThan(MIN_SEGMENT_MS); // the dropped one, stated explicitly
  });

  it("merges speech split by a gap ≤ mergeGapMs into one interval", () => {
    const out = speechIntervals(
      [
        { startMs: 3000, endMs: 3200 }, // 200 ms gap — below the merge threshold
      ],
      9000,
      NO_PAD,
    );
    expect(out).toEqual([{ startMs: 0, endMs: 9000 }]);
  });

  it("whole-file speech when there is no silence", () => {
    expect(speechIntervals([], 5000)).toEqual([{ startMs: 0, endMs: 5000 }]);
  });

  it("clamps silence bounds to [0, total]", () => {
    const out = speechIntervals([{ startMs: -500, endMs: 3000 }], 8000, NO_PAD);
    expect(out).toEqual([{ startMs: 3000, endMs: 8000 }]);
  });
});

describe("speechIntervals padding (E-16b criterion 3)", () => {
  // Energy detection finds the loud core of a word; its onset and decay sit under
  // any threshold. Cutting at the detected edge clipped real speech, which is what
  // the operator heard, so every interval grows by PAD_MS on both sides.
  it("grows each interval by the pre/post-roll, clamped to the file", () => {
    const out = speechIntervals([{ startMs: 3000, endMs: 6000 }], 9000);
    expect(out).toEqual([
      { startMs: 0, endMs: 3000 + PAD_MS }, // start clamps at 0
      { startMs: 6000 - PAD_MS, endMs: 9000 }, // end clamps at the total
    ]);
  });

  it("merges two utterances the padding grows into each other", () => {
    // A 1.1 s gap is wider than MERGE_GAP_MS on its own, but 250 ms of roll on
    // each side closes it to 600 ms — one continuous stretch of speech.
    const out = speechIntervals([{ startMs: 3000, endMs: 4100 }], 9000);
    expect(out).toEqual([{ startMs: 0, endMs: 9000 }]);
  });

  it("counts the padding toward the minimum length", () => {
    // A 1.2 s utterance — under MIN_SEGMENT_MS bare, kept once padded to 1.7 s.
    const out = speechIntervals(
      [
        { startMs: 0, endMs: 4000 },
        { startMs: 5200, endMs: 9000 },
      ],
      9000,
    );
    expect(out).toEqual([{ startMs: 3750, endMs: 5450 }]);
  });
});

describe("speechIntervals bounds segment length (E-16 defect 3)", () => {
  // Merging never split, so continuous background sound (a café, a TV left on)
  // yielded ONE multi-hour "speech" segment — which cascade.ts then read whole
  // into a Buffer and base64-encoded for the API, breaking analysis at exactly
  // the day scale D-9 promises, and doing so AFTER the triage had been billed.
  const total = (ivs: { startMs: number; endMs: number }[]) =>
    ivs.reduce((n, iv) => n + (iv.endMs - iv.startMs), 0);

  it("splits a 3-hour continuous tone into pieces that each fit the cap", () => {
    const THREE_HOURS = 3 * 60 * 60 * 1000;
    const out = speechIntervals([], THREE_HOURS); // no silence at all

    expect(out.length).toBeGreaterThan(1); // was exactly 1 before the fix
    for (const iv of out) expect(iv.endMs - iv.startMs).toBeLessThanOrEqual(MAX_SEGMENT_MS);
    // Contiguous, ordered, and covering the whole span — no speech is lost.
    expect(out[0].startMs).toBe(0);
    expect(out[out.length - 1].endMs).toBe(THREE_HOURS);
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBe(out[i - 1].endMs); // contiguous
      expect(out[i].endMs).toBeGreaterThan(out[i].startMs); // correctly ordered
    }
    expect(total(out)).toBe(THREE_HOURS); // total speech time preserved exactly
  });

  it("leaves an interval already under the cap untouched", () => {
    const out = speechIntervals([], MAX_SEGMENT_MS - 1000);
    expect(out).toEqual([{ startMs: 0, endMs: MAX_SEGMENT_MS - 1000 }]);
  });

  it("cuts at the quietest contained dip rather than flat at the ideal point", () => {
    // 8 minutes of continuous speech broken only by two sub-merge-threshold
    // pauses (100 ms and 250 ms) — both merged over, so both are candidate cut
    // points. It splits into 3 pieces with ideal cuts at 160 s and 320 s; the
    // dips sit near the first, and the LONGER pause is the better boundary.
    const EIGHT_MIN = 8 * 60 * 1000;
    const out = speechIntervals(
      [
        { startMs: 156_000, endMs: 156_100 }, // 100 ms dip
        { startMs: 163_000, endMs: 163_250 }, // 250 ms dip — the quietest
      ],
      EIGHT_MIN,
      { mergeGapMs: 300 },
    );
    expect(out).toHaveLength(3);
    expect(out[0].endMs).toBe(163_125); // the midpoint of the longer pause
    expect(out[1].startMs).toBe(163_125); // still contiguous
    for (const iv of out) expect(iv.endMs - iv.startMs).toBeLessThanOrEqual(MAX_SEGMENT_MS);
    expect(total(out)).toBe(EIGHT_MIN); // and no speech time lost to the cut
  });

  it("splits so that no piece is dropped as sub-minimum", () => {
    // Just over the cap: a naive "cut at the cap" would leave a 1 s tail, which
    // the min-length filter would then discard — silently losing speech.
    const out = speechIntervals([], MAX_SEGMENT_MS + 1000);
    expect(out).toHaveLength(2);
    for (const iv of out) {
      expect(iv.endMs - iv.startMs).toBeLessThanOrEqual(MAX_SEGMENT_MS);
      expect(iv.endMs - iv.startMs).toBeGreaterThanOrEqual(MIN_SEGMENT_MS);
    }
    expect(total(out)).toBe(MAX_SEGMENT_MS + 1000);
  });

  it("honours an explicit maxSegmentMs override", () => {
    const out = speechIntervals([], 10_000, { maxSegmentMs: 3000 });
    expect(out).toHaveLength(4); // ceil(10/3)
    for (const iv of out) expect(iv.endMs - iv.startMs).toBeLessThanOrEqual(3000);
    expect(total(out)).toBe(10_000);
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
