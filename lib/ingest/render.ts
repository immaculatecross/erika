import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { renditionCachePath } from "../audio-storage";
import { atomicOutput, runFfmpeg } from "./ffmpeg";

// The on-disk segment artifacts of the pipeline (D-10). Extraction and the
// time-compressed triage rendition are both ffmpeg file→file; the content hash
// is streamed, not slurped — so none of this scales with recording length.

/** Rendition tempo: configurable via TRIAGE_TEMPO, default 1.5, range 1.25–1.5. */
export const DEFAULT_TRIAGE_TEMPO = 1.5;
export const MIN_TRIAGE_TEMPO = 1.25;
export const MAX_TRIAGE_TEMPO = 1.5;

/** Thrown when TRIAGE_TEMPO is non-numeric or outside the allowed range. */
export class TempoError extends Error {}

/** Resolve and validate the configured triage tempo, truthfully rejecting bad input. */
export function triageTempo(raw: string | number | undefined = process.env.TRIAGE_TEMPO): number {
  if (raw === undefined || raw === "") return DEFAULT_TRIAGE_TEMPO;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < MIN_TRIAGE_TEMPO || n > MAX_TRIAGE_TEMPO) {
    throw new TempoError(
      `TRIAGE_TEMPO must be a number in [${MIN_TRIAGE_TEMPO}, ${MAX_TRIAGE_TEMPO}]; got ${String(raw)}.`,
    );
  }
  return n;
}

/**
 * Extract [startMs, endMs) of the normalized file to `dest` as 16 kHz mono PCM.
 * File→file via -ss/-to. Idempotent by caller: a resumed job that re-reaches an
 * index that already has both a row and this file skips the call entirely.
 */
export async function extractSegment(
  normalizedFile: string,
  startMs: number,
  endMs: number,
  dest: string,
): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  await runFfmpeg([
    "-y",
    "-i",
    normalizedFile,
    "-ss",
    (startMs / 1000).toFixed(3),
    "-to",
    (endMs / 1000).toFixed(3),
    "-c:a",
    "pcm_s16le",
    dest,
  ]);
}

/** SHA-256 of a file, streamed in chunks — never loads the whole file. */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/**
 * Produce (or reuse) the cached, time-compressed rendition for a segment, keyed
 * by content hash + tempo under the shared data/cache/. Identical audio — even
 * across sessions — hits the cache and is never re-rendered. Returns the cache
 * path and whether it was a hit.
 *
 * The render is written atomically (temp file + rename): a worker killed mid-
 * atempo leaves only a temp file, never a truncated rendition at the cache path.
 * Because this cache is shared by content hash across all sessions (D-10 — never
 * re-billed), a torn file at `dest` would become a permanent hit reused
 * everywhere; the atomic write guarantees a cache hit is only ever a whole file.
 */
export async function renderRendition(
  segmentFile: string,
  contentHash: string,
  tempo: number,
): Promise<{ path: string; cached: boolean }> {
  const dest = renditionCachePath(contentHash, tempo);
  if (await exists(dest)) return { path: dest, cached: true };
  await mkdir(path.dirname(dest), { recursive: true });
  await atomicOutput(dest, (tmp) =>
    runFfmpeg([
      "-y",
      "-i",
      segmentFile,
      "-filter:a",
      `atempo=${tempo}`,
      "-c:a",
      "pcm_s16le",
      tmp,
    ]),
  );
  return { path: dest, cached: false };
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}
