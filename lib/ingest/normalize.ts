import { stat } from "node:fs/promises";
import { runFfmpeg, probeField } from "./ffmpeg";

// Stage 1: normalize the source to 16 kHz mono PCM (D-10 — one canonical form
// everything downstream reads). Resampling preserves the timeline, so segment
// timestamps computed on the normalized file map 1:1 onto the source timeline.
// File→file: ffmpeg reads the source and writes the rendition; Node never holds
// the audio.

export const NORMALIZED_SAMPLE_RATE = 16000;
export const NORMALIZED_CHANNELS = 1;

/**
 * Write a 16 kHz mono PCM WAV of `source` to `dest`. Idempotent: if `dest`
 * already probes as 16 kHz mono it is left untouched and `false` is returned,
 * so a resumed job skips this expensive step. Returns whether it (re)wrote.
 */
export async function normalize(source: string, dest: string): Promise<boolean> {
  if (await isNormalized(dest)) return false;
  await runFfmpeg([
    "-y",
    "-i",
    source,
    "-ac",
    String(NORMALIZED_CHANNELS),
    "-ar",
    String(NORMALIZED_SAMPLE_RATE),
    "-c:a",
    "pcm_s16le",
    dest,
  ]);
  return true;
}

/** True when `file` exists and probes as 16 kHz mono — the resume checkpoint. */
export async function isNormalized(file: string): Promise<boolean> {
  try {
    if ((await stat(file)).size === 0) return false;
  } catch {
    return false;
  }
  const [rate, channels] = await Promise.all([
    probeField(file, "stream=sample_rate"),
    probeField(file, "stream=channels"),
  ]);
  return Number(rate) === NORMALIZED_SAMPLE_RATE && Number(channels) === NORMALIZED_CHANNELS;
}
