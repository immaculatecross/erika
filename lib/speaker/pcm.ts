import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { runFfmpeg } from "../ingest/ffmpeg";

// Read a bounded audio WINDOW as mono float samples (E-36). ffmpeg decodes [startMs,
// endMs) of the wav to 16 kHz mono signed-16 PCM in a temp file; we read that small
// slice into memory (a few seconds — never a whole recording) and hand back
// normalized floats for the spectral embedder. This lives OUTSIDE lib/ingest on
// purpose: the ingest memory-safety tripwire forbids any whole-file Buffer read
// there, and a per-window read is exactly the bounded exception the embedder needs.

export const EMBED_SAMPLE_RATE = 16_000;

/**
 * Decode [startMs, endMs) of `wavPath` to mono 16 kHz PCM and return the samples as
 * a Float32Array in [-1, 1]. File→file through ffmpeg (a temp raw file, removed
 * after the read), so nothing but the window's own bytes ever reaches Node. Throws
 * FfmpegError on a decode failure — the caller treats that as "unattributed".
 */
export async function readWindowSamples(
  wavPath: string,
  startMs: number,
  endMs: number,
  sampleRate: number = EMBED_SAMPLE_RATE,
): Promise<Float32Array> {
  const dir = await mkdtemp(path.join(tmpdir(), "erika-embed-"));
  const raw = path.join(dir, `${randomUUID()}.s16le`);
  try {
    await runFfmpeg([
      "-y",
      "-i",
      wavPath,
      "-ss",
      (startMs / 1000).toFixed(3),
      "-to",
      (endMs / 1000).toFixed(3),
      "-ac",
      "1",
      "-ar",
      String(sampleRate),
      "-f",
      "s16le",
      "-acodec",
      "pcm_s16le",
      raw,
    ]);
    const buf = await readFile(raw);
    const n = Math.floor(buf.length / 2);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
