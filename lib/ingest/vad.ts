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

// ---- calibration (E-16b criterion 3) -------------------------------------
//
// The first cut used a FIXED −30 dBFS floor, no padding, a 300 ms merge gap and a
// 2 s minimum. The operator ran the app on real speech and genuine utterances came
// back missing. Every constant below was re-derived and is asserted against a
// committed, labelled speech sample (tests/fixtures/labelled-speech.flac): the old
// values recall 51.5 % of the labelled speech, these recall 100 %.

/**
 * How far above the recording's OWN measured noise floor the speech threshold
 * sits (dB). A fixed −30 dBFS was an absolute guess about a relative quantity: a
 * quiet room floors around −60 dBFS, so −30 sat *inside* the speech and cut the
 * low-energy parts of real words out. Conversational speech runs 25–40 dB above
 * its room floor, so +12 dB clears the room's own crest (noise peaks a few dB
 * above its RMS) while staying far below anything a person actually said.
 */
export const NOISE_MARGIN_DB = 12;
/**
 * Bounds the measured threshold may never leave (dBFS).
 *
 * The ceiling is the old fixed −30 dB: whatever a recording's floor turns out to
 * be, the new rule can never be MORE aggressive than the behaviour that was
 * already dropping speech. The floor is −55 dB, below which the threshold stops
 * discriminating and VAD would keep the whole file — destroying the cost
 * architecture VAD exists for (D-10).
 */
export const MIN_THRESHOLD_DB = -55;
export const MAX_THRESHOLD_DB = -30;
/** Minimum silence duration ffmpeg must see before it reports a gap (seconds). */
export const MIN_SILENCE_S = 0.3;
/**
 * Pre/post-roll kept around every detected interval (ms).
 *
 * Energy detection finds the *loud* part of a word. The onset of a plosive and
 * the decay of a final consonant sit below any threshold, so cutting exactly at
 * the detected edge clips the beginning and end of real utterances — which is
 * precisely what the operator heard. 250 ms is roughly one syllable: enough to
 * recover the whole word, short enough not to bill silence.
 */
export const PAD_MS = 250;
/**
 * Speech intervals separated by a gap this small (ms) are merged into one.
 *
 * 300 ms was below the length of an ordinary pause — clause boundaries, a breath,
 * a hesitation mid-sentence all run 400–600 ms — so single sentences were chopped
 * into fragments and analyzed out of context. 700 ms keeps a sentence whole while
 * staying under the ~1 s that marks a genuine turn boundary.
 */
export const MERGE_GAP_MS = 700;
/**
 * Segments shorter than this (ms) are discarded — too short to analyze.
 *
 * Revisited down from 2000 ms. This is measured AFTER padding, so 1600 ms of kept
 * audio is about 1.1 s of core speech: still a real utterance ("I don't know",
 * "not really"), where the 2 s bar demanded ~1.5 s and threw genuine short
 * answers away entirely.
 */
export const MIN_SEGMENT_MS = 1600;
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

/** Options every caller of the pure interval math may override (tests do). */
export interface IntervalOpts {
  padMs?: number;
  mergeGapMs?: number;
  minSegmentMs?: number;
  maxSegmentMs?: number;
}

/**
 * Pure interval math: invert silences to speech intervals over [0, totalMs], grow
 * each by padMs on both sides (clamped to the file), merge intervals split by a
 * gap ≤ mergeGapMs, split anything longer than maxSegmentMs, and drop any under
 * minSegmentMs. Deterministic and unit-tested in isolation.
 *
 * Padding runs BEFORE merging on purpose: two utterances the padding grows into
 * each other are one continuous stretch of speech, and merging them is right.
 */
export function speechIntervals(
  silences: Silence[],
  totalMs: number,
  opts: IntervalOpts = {},
): Interval[] {
  const padMs = opts.padMs ?? PAD_MS;
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

  const padded = speech.map((iv) => ({
    startMs: Math.max(0, iv.startMs - padMs),
    endMs: Math.min(totalMs, iv.endMs + padMs),
  }));

  const merged: Interval[] = [];
  for (const iv of padded) {
    const prev = merged[merged.length - 1];
    if (prev && iv.startMs - prev.endMs <= mergeGapMs) prev.endMs = Math.max(prev.endMs, iv.endMs);
    else merged.push({ ...iv });
  }

  // Split before filtering: a bounded piece is still speech, and the cap is what
  // keeps any one segment small enough to buffer and base64-encode (D-9 scale).
  const bounded = merged.flatMap((iv) => splitLong(iv, silences, maxSegmentMs));

  return bounded.filter((iv) => iv.endMs - iv.startMs >= minSegmentMs);
}

/**
 * Pull the overall noise floor (dBFS) out of ffmpeg `astats` output. astats prints
 * a block per channel and then an Overall block, so the LAST reading is the one
 * that describes the whole file. Digital silence reports `-inf`, which comes back
 * as -Infinity and is handled by `speechThresholdDb`.
 */
export function parseNoiseFloor(stderr: string): number {
  const matches = [...stderr.matchAll(/Noise floor dB:\s*(-?[\d.]+|-?inf)/gi)];
  const last = matches[matches.length - 1]?.[1];
  if (last === undefined) return Number.NaN;
  return /inf$/i.test(last) ? (last.startsWith("-") ? -Infinity : Infinity) : Number(last);
}

/**
 * The silencedetect threshold for a recording whose measured floor is `floorDb`:
 * NOISE_MARGIN_DB above it, clamped into [MIN_THRESHOLD_DB, MAX_THRESHOLD_DB]. An
 * unmeasurable floor (-inf on digital silence, or NaN if astats said nothing)
 * falls back to the clamp's lower bound — the most conservative choice, and the
 * one that keeps the tone/silence fixtures behaving exactly as before.
 */
export function speechThresholdDb(floorDb: number): number {
  if (!Number.isFinite(floorDb)) return MIN_THRESHOLD_DB;
  const raw = Math.round((floorDb + NOISE_MARGIN_DB) * 10) / 10;
  return Math.min(MAX_THRESHOLD_DB, Math.max(MIN_THRESHOLD_DB, raw));
}

/** Measure a file's own noise floor (dBFS) with ffmpeg's `astats` filter. */
export async function measureNoiseFloorDb(file: string): Promise<number> {
  return parseNoiseFloor(await runFfmpeg(["-i", file, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"]));
}

/**
 * Measure the file's noise floor, run silencedetect at a threshold relative to it,
 * and return the kept speech intervals (source timeline). File→file: ffmpeg reads
 * the audio; only its stderr text comes back to Node. Two passes rather than one —
 * the second pass's threshold depends on the first's answer, and both are cheap
 * relative to normalize/extract.
 */
export async function detectSpeech(
  normalizedFile: string,
  opts: IntervalOpts & { thresholdDb?: number } = {},
): Promise<Interval[]> {
  const totalMs = Math.round((await probeDuration(normalizedFile)) * 1000);
  const thresholdDb = opts.thresholdDb ?? speechThresholdDb(await measureNoiseFloorDb(normalizedFile));
  const stderr = await runFfmpeg([
    "-i",
    normalizedFile,
    "-af",
    `silencedetect=noise=${thresholdDb}dB:d=${MIN_SILENCE_S}`,
    "-f",
    "null",
    "-",
  ]);
  return speechIntervals(parseSilences(stderr, totalMs), totalMs, opts);
}
