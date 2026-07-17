import { runFfmpeg, probeDuration } from "./ffmpeg";

// Stage 2: voice-activity detection via ffmpeg's energy-based `silencedetect`
// (D-7, D-10). We run it on the normalized audio, parse silence_start/end from
// stderr, invert those to speech intervals, merge intervals split by a tiny
// gap, and drop anything under the minimum. Dependency-free, deterministic, and
// fixture-testable — no native/WASM VAD binary.
//
// FUTURE: a learned speech/noise model (and speaker attribution, E-13) is the
// planned upgrade. It is deliberately out of scope here; energy thresholding is
// enough to strip the silence that dominates a day-long dump.

/** Silence deeper than this (dBFS) for at least MIN_SILENCE_S counts as a gap. */
export const NOISE_FLOOR_DB = -30;
/** Minimum silence duration ffmpeg must see before it reports a gap (seconds). */
export const MIN_SILENCE_S = 0.3;
/** Speech intervals separated by a gap this small (ms) are merged into one. */
export const MERGE_GAP_MS = 300;
/** Segments shorter than this (ms) are discarded — too short to analyze. */
export const MIN_SEGMENT_MS = 2000;

export interface Interval {
  startMs: number;
  endMs: number;
}

/** One detected silence window, in ms on the source timeline. */
export interface Silence {
  startMs: number;
  endMs: number;
}

/** Parse silence_start/silence_end pairs (seconds → ms) out of ffmpeg stderr. */
export function parseSilences(stderr: string, totalMs: number): Silence[] {
  const out: Silence[] = [];
  let openStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (start) {
      openStart = Math.max(0, Math.round(Number(start[1]) * 1000));
      continue;
    }
    const end = line.match(/silence_end:\s*(-?[\d.]+)/);
    if (end && openStart !== null) {
      out.push({ startMs: openStart, endMs: Math.round(Number(end[1]) * 1000) });
      openStart = null;
    }
  }
  // A file that ends in silence leaves silence_start with no matching end.
  if (openStart !== null) out.push({ startMs: openStart, endMs: totalMs });
  return out;
}

/**
 * Pure interval math: invert silences to speech intervals over [0, totalMs],
 * merge intervals split by a gap ≤ mergeGapMs, clamp to bounds, and drop any
 * under minSegmentMs. Deterministic and unit-tested in isolation.
 */
export function speechIntervals(
  silences: Silence[],
  totalMs: number,
  opts: { mergeGapMs?: number; minSegmentMs?: number } = {},
): Interval[] {
  const mergeGapMs = opts.mergeGapMs ?? MERGE_GAP_MS;
  const minSegmentMs = opts.minSegmentMs ?? MIN_SEGMENT_MS;

  const sorted = [...silences].sort((a, b) => a.startMs - b.startMs);
  const speech: Interval[] = [];
  let cursor = 0;
  for (const s of sorted) {
    const start = Math.max(0, Math.min(s.startMs, totalMs));
    const end = Math.max(0, Math.min(s.endMs, totalMs));
    if (start > cursor) speech.push({ startMs: cursor, endMs: start });
    cursor = Math.max(cursor, end);
  }
  if (cursor < totalMs) speech.push({ startMs: cursor, endMs: totalMs });

  const merged: Interval[] = [];
  for (const iv of speech) {
    const prev = merged[merged.length - 1];
    if (prev && iv.startMs - prev.endMs <= mergeGapMs) prev.endMs = iv.endMs;
    else merged.push({ ...iv });
  }

  return merged.filter((iv) => iv.endMs - iv.startMs >= minSegmentMs);
}

/**
 * Run silencedetect on the normalized file and return the kept speech intervals
 * (source timeline). File→file: ffmpeg reads the audio; only its stderr text
 * comes back to Node.
 */
export async function detectSpeech(
  normalizedFile: string,
  opts: { mergeGapMs?: number; minSegmentMs?: number } = {},
): Promise<Interval[]> {
  const totalMs = Math.round((await probeDuration(normalizedFile)) * 1000);
  const stderr = await runFfmpeg([
    "-i",
    normalizedFile,
    "-af",
    `silencedetect=noise=${NOISE_FLOOR_DB}dB:d=${MIN_SILENCE_S}`,
    "-f",
    "null",
    "-",
  ]);
  return speechIntervals(parseSilences(stderr, totalMs), totalMs, opts);
}
