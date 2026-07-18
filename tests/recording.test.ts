import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assembleChunks,
  encodeWav,
  formatElapsed,
  levelFromAnalyser,
  pickRecordingMime,
  recordingFilename,
  TAKE_LOST_MESSAGE,
  takeOutcome,
} from "@/lib/recording";

// The mic recorder's pure logic (E-2 part 2). Every acceptance criterion that
// can be tested off the DOM is pinned here; the browser wiring is exercised by
// the Playwright fake-device e2e.

describe("formatElapsed (criterion 4)", () => {
  it("formats across the m:ss / h:mm:ss boundaries in tabular form", () => {
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(3_661_000)).toBe("1:01:01");
  });

  it("floors the in-progress second and clamps negatives to zero", () => {
    expect(formatElapsed(9_999)).toBe("0:09");
    expect(formatElapsed(-500)).toBe("0:00");
  });
});

describe("levelFromAnalyser (criterion 3)", () => {
  it("reads silence (a flat 128 buffer) as ~0", () => {
    const silence = new Uint8Array(1024).fill(128);
    expect(levelFromAnalyser(silence)).toBeCloseTo(0, 5);
  });

  it("reads a full-scale buffer as near 1", () => {
    const loud = new Uint8Array(1024);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 0 : 255;
    expect(levelFromAnalyser(loud)).toBeGreaterThan(0.9);
  });

  it("orders quiet below loud", () => {
    const quiet = new Uint8Array(1024);
    for (let i = 0; i < quiet.length; i++) quiet[i] = i % 2 === 0 ? 120 : 136; // ±8
    const loud = new Uint8Array(1024);
    for (let i = 0; i < loud.length; i++) loud[i] = i % 2 === 0 ? 40 : 216; // ±88
    expect(levelFromAnalyser(quiet)).toBeLessThan(levelFromAnalyser(loud));
    expect(levelFromAnalyser(quiet)).toBeGreaterThan(0);
  });

  it("handles an empty buffer without dividing by zero", () => {
    expect(levelFromAnalyser(new Uint8Array(0))).toBe(0);
  });
});

describe("assembleChunks (criterion 2)", () => {
  it("concatenates N chunks into one Blob of the summed bytes, in order", async () => {
    const chunks = [
      new Blob([new Uint8Array([1, 2, 3])]),
      new Blob([new Uint8Array([4, 5])]),
      new Blob([new Uint8Array([6, 7, 8, 9])]),
    ];
    const blob = assembleChunks(chunks, "audio/webm");
    expect(blob.type).toBe("audio/webm");
    expect(blob.size).toBe(9);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("assembles an empty take into an empty blob (no throw)", () => {
    expect(assembleChunks([], "audio/webm").size).toBe(0);
  });
});

describe("pickRecordingMime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when MediaRecorder is unavailable", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickRecordingMime()).toBeNull();
  });

  it("prefers Opus-in-WebM when supported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (t: string) => t === "audio/webm;codecs=opus",
    });
    expect(pickRecordingMime()).toBe("audio/webm;codecs=opus");
  });

  it("falls back to MP4/AAC (Safari) when WebM is unsupported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (t: string) => t === "audio/mp4",
    });
    expect(pickRecordingMime()).toBe("audio/mp4");
  });

  it("returns null when the browser supports none of the candidates", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(pickRecordingMime()).toBeNull();
  });
});

describe("encodeWav (normalizes a take to a probeable format)", () => {
  const read4 = (view: DataView, offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );

  it("writes a valid 16-bit PCM WAV header with an exact sample count", async () => {
    const sampleRate = 48_000;
    const frames = 4_800; // 0.1 s at 48 kHz
    const mono = new Float32Array(frames).fill(0.5);
    const blob = encodeWav([mono], sampleRate);
    const view = new DataView(await blob.arrayBuffer());

    expect(blob.type).toBe("audio/wav");
    expect(read4(view, 0)).toBe("RIFF");
    expect(read4(view, 8)).toBe("WAVE");
    expect(read4(view, 36)).toBe("data");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(sampleRate);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    // data chunk = frames * channels * 2 bytes; total = 44-byte header + data.
    expect(view.getUint32(40, true)).toBe(frames * 2);
    expect(blob.size).toBe(44 + frames * 2);
    // The duration ffprobe will read: dataSize / byteRate = frames / sampleRate.
    const byteRate = view.getUint32(28, true);
    expect((frames * 2) / byteRate).toBeCloseTo(frames / sampleRate, 6);
  });

  it("interleaves stereo channels and clamps out-of-range samples", async () => {
    const left = new Float32Array([1.5, 0]); // clamps to +1 → 32767
    const right = new Float32Array([-1.5, 0]); // clamps to -1 → -32768
    const view = new DataView(await encodeWav([left, right], 44_100).arrayBuffer());
    expect(view.getUint16(22, true)).toBe(2); // stereo
    expect(view.getInt16(44, true)).toBe(32767); // frame 0, left
    expect(view.getInt16(46, true)).toBe(-32768); // frame 0, right
  });
});

describe("recordingFilename", () => {
  it("builds a filesystem-safe name with a supported extension", () => {
    const at = new Date("2026-07-17T18:30:00.000Z");
    expect(recordingFilename("webm", at)).toBe("recording-2026-07-17T18-30-00.webm");
  });
});

describe("takeOutcome (E-16b criterion 6)", () => {
  // A take the browser cannot decode is GONE. It used to resolve null and the UI
  // slid quietly back to idle, so the person never learned their recording had
  // been discarded — the worst failure this app can have.
  it("reports a lost take rather than returning nothing quietly", () => {
    expect(takeOutcome(null)).toEqual({ take: null, lost: true });
    expect(TAKE_LOST_MESSAGE).toMatch(/lost/i);
    expect(TAKE_LOST_MESSAGE).toMatch(/record again/i);
  });

  it("passes a good take through as an uploadable wav", () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    expect(takeOutcome(blob)).toEqual({ take: { blob, extension: "wav" }, lost: false });
  });
});
