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
/**
 * No speech segment may exceed this (ms) — 4 minutes (E-16 defect 3).
 *
 * Merging alone never split, so continuous background sound (a café, a TV left
 * on) collapsed a whole day into ONE "speech" interval. `cascade.ts` then read
 * that segment whole into a Buffer and base64-encoded it for the API — analysis
 * broke at exactly the day scale D-9 promises, and broke *after* the triage had
 * already been billed. Four minutes keeps a base64 mono clip comfortably inside
 * request limits, stays well under the D-3 ~10-minute chunking guidance, and is
 * long enough that a normal turn of speech is not chopped mid-thought.
 */
export const MAX_SEGMENT_MS = 240_000;
/**
 * Fraction of MAX_SEGMENT_MS a split aims to fill. The remaining 15 % is the
 * slack a cut may drift within to reach the quietest nearby pause instead of
 * landing flat — and possibly mid-word — on its ideal point.
 */
const SPLIT_FILL = 0.85;

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
 * Split one over-long interval into contiguous pieces, each ≤ maxMs.
 *
 * Cuts land as close as possible to evenly spaced ideal points, but snap to the
 * *quietest contained dip* when one lies within reach — a dip here is a silence
 * that merging swallowed (a pause below mergeGapMs), and the longest such pause
 * is the most natural boundary. A dip is cut at its MIDPOINT, so the pieces stay
 * contiguous and the total speech time is preserved exactly; with no dip in
 * reach it falls back to a flat cut at the ideal point.
 *
 * The snap window is bounded so no drift can push a piece past maxMs (half the
 * slack between the ideal length and the cap) or make one runt-short (a quarter
 * of the ideal length) — every piece therefore lands in [ideal/2, maxMs].
 */
function splitLong(iv: Interval, silences: Silence[], maxMs: number): Interval[] {
  const len = iv.endMs - iv.startMs;
  if (len <= maxMs) return [iv];

  // Aim each piece at SPLIT_FILL of the cap rather than the cap itself. Packing
  // to exactly the cap leaves zero slack, so every cut would be forced to land
  // flat on its ideal point — quite possibly mid-word — with no room to reach a
  // natural pause. Under-filling buys that room while keeping every piece ≤ cap.
  const pieces = Math.ceil(len / (maxMs * SPLIT_FILL));
  const ideal = len / pieces;
  const window = Math.min((maxMs - ideal) / 2, ideal / 4);
  const dips = silences.filter((s) => s.startMs >= iv.startMs && s.endMs <= iv.endMs);

  const out: Interval[] = [];
  let cursor = iv.startMs;
  for (let k = 1; k < pieces; k++) {
    const idealCut = iv.startMs + ideal * k;
    const cut = Math.round(quietestDipNear(dips, idealCut, window) ?? idealCut);
    out.push({ startMs: cursor, endMs: cut });
    cursor = cut;
  }
  out.push({ startMs: cursor, endMs: iv.endMs });
  return out;
}

/** Midpoint of the longest silence whose own midpoint is within `window` of `at`. */
function quietestDipNear(dips: Silence[], at: number, window: number): number | null {
  let best: { mid: number; len: number } | null = null;
  for (const d of dips) {
    const mid = (d.startMs + d.endMs) / 2;
    if (Math.abs(mid - at) > window) continue;
    const len = d.endMs - d.startMs;
    // Longest pause wins; a tie goes to the cut nearest the ideal point.
    if (!best || len > best.len || (len === best.len && Math.abs(mid - at) < Math.abs(best.mid - at))) {
      best = { mid, len };
    }
  }
  return best ? best.mid : null;
}

/**
 * Pure interval math: invert silences to speech intervals over [0, totalMs],
 * merge intervals split by a gap ≤ mergeGapMs, split anything longer than
 * maxSegmentMs, clamp to bounds, and drop any under minSegmentMs. Deterministic
 * and unit-tested in isolation.
 */
export function speechIntervals(
  silences: Silence[],
  totalMs: number,
  opts: { mergeGapMs?: number; minSegmentMs?: number; maxSegmentMs?: number } = {},
): Interval[] {
  const mergeGapMs = opts.mergeGapMs ?? MERGE_GAP_MS;
  const minSegmentMs = opts.minSegmentMs ?? MIN_SEGMENT_MS;
  const maxSegmentMs = opts.maxSegmentMs ?? MAX_SEGMENT_MS;

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

  // Split before filtering: a bounded piece is still speech, and the cap is what
  // keeps any one segment small enough to buffer and base64-encode (D-9 scale).
  const bounded = merged.flatMap((iv) => splitLong(iv, silences, maxSegmentMs));

  return bounded.filter((iv) => iv.endMs - iv.startMs >= minSegmentMs);
}

/**
 * Run silencedetect on the normalized file and return the kept speech intervals
 * (source timeline). File→file: ffmpeg reads the audio; only its stderr text
 * comes back to Node.
 */
export async function detectSpeech(
  normalizedFile: string,
  opts: { mergeGapMs?: number; minSegmentMs?: number; maxSegmentMs?: number } = {},
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
