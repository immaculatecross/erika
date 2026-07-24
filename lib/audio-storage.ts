import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

// The home for a session's files: data/sessions/<id>/. E-3 will drop normalized
// audio and speech segments alongside the source here. Server-only. The data
// root mirrors the DB location and is overridable for tests via ERIKA_DATA_DIR.

function dataDir(): string {
  return process.env.ERIKA_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function sessionDir(id: string): string {
  return path.join(dataDir(), "sessions", id);
}

/** Absolute path of a session's source recording (extension = its format). */
export function sourcePath(id: string, format: string): string {
  return path.join(sessionDir(id), `source.${format}`);
}

/** The 16 kHz mono normalized rendition of a session's source (E-3). */
export function normalizedPath(id: string): string {
  return path.join(sessionDir(id), "normalized.wav");
}

/** A session's extracted speech segment, by ordered index (E-3). */
export function segmentPath(id: string, idx: number): string {
  return path.join(sessionDir(id), "segments", `seg-${String(idx).padStart(4, "0")}.wav`);
}

/** Ensure data/sessions/<id>/segments/ exists; returns its path. */
export async function ensureSegmentsDir(id: string): Promise<string> {
  const dir = path.join(sessionDir(id), "segments");
  await mkdir(dir, { recursive: true });
  return dir;
}

// Renditions are cached by content hash under a shared data/cache/ dir, so an
// identical segment — even across sessions — reuses one artifact. A cache entry
// is NOT removed when one session is deleted: another session may still key it.

/** The shared, cross-session rendition cache dir: data/cache/. */
export function cacheDir(): string {
  return path.join(dataDir(), "cache");
}

/** Cache path of a segment's time-compressed rendition, keyed by hash + tempo. */
export function renditionCachePath(contentHash: string, tempo: number): string {
  return path.join(cacheDir(), `${contentHash}.t${tempo}.wav`);
}

/** Ensure data/cache/ exists; returns its path. */
export async function ensureCacheDir(): Promise<string> {
  const dir = cacheDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Create data/sessions/<id>/ if absent; returns the directory path. */
export async function ensureSessionDir(id: string): Promise<string> {
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  return dir;
}

// Contrastive-playback renditions (E-21) live under a flat data/renditions/ dir,
// keyed by finding id — one rendered correction clip per finding, cached forever.
// Unlike the hash-keyed segment cache these are per-finding, so a session delete
// removes them (the delete route unlinks the files after the FK cascade drops the
// rows); playback is orphan-safe if a file is missing anyway.

/** The renditions dir: data/renditions/. */
export function renditionsDir(): string {
  return path.join(dataDir(), "renditions");
}

/** On-disk path of a finding's rendered correction clip (mp3). */
export function renditionPath(findingId: string): string {
  return path.join(renditionsDir(), `${findingId}.mp3`);
}

/** Ensure data/renditions/ exists; returns its path. */
export async function ensureRenditionsDir(): Promise<string> {
  const dir = renditionsDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Remove one rendition file (idempotent — no error if absent). */
export async function removeRenditionFile(filePath: string): Promise<void> {
  await rm(filePath, { force: true });
}

// Phrase renders (E-33): the shadow/reading formats render an arbitrary CORRECT
// Italian phrase to cached audio, keyed by a content hash of (text + register +
// voice) rather than by a finding — a per-phrase cache shared across formats so the
// same phrase at the same register renders once, ever. They live under a flat
// data/phrase-renders/ dir, named by hash; a hash is safe as a filename by
// construction (hex).

/** The phrase-renders dir: data/phrase-renders/. */
export function phraseRendersDir(): string {
  return path.join(dataDir(), "phrase-renders");
}

/** On-disk path of a rendered phrase clip (mp3), keyed by its content hash. */
export function phraseRenderPath(hash: string): string {
  return path.join(phraseRendersDir(), `${hash}.mp3`);
}

/** Ensure data/phrase-renders/ exists; returns its path. */
export async function ensurePhraseRendersDir(): Promise<string> {
  const dir = phraseRendersDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Remove a session's whole directory (idempotent — no error if absent). */
export async function removeSessionDir(id: string): Promise<void> {
  await rm(sessionDir(id), { recursive: true, force: true });
}

/** Thrown by streamToFile when the byte cap is exceeded mid-stream. */
export class UploadTooLargeError extends Error {}

/**
 * Pipe a web request body to `dest` chunk by chunk, never holding the whole
 * file in memory. Enforces `maxBytes` while streaming: on the first chunk that
 * pushes past the cap it aborts, deletes the partial file, and throws
 * UploadTooLargeError. Returns the exact byte count written on success.
 */
export async function streamToFile(
  body: WebReadableStream<Uint8Array>,
  dest: string,
  maxBytes: number,
): Promise<number> {
  const source = Readable.fromWeb(body);
  const out = createWriteStream(dest);
  let total = 0;
  try {
    for await (const chunk of source) {
      total += (chunk as Uint8Array).byteLength;
      if (total > maxBytes) {
        throw new UploadTooLargeError(`Upload exceeds the ${maxBytes}-byte limit.`);
      }
      if (!out.write(chunk)) await once(out, "drain");
    }
    await new Promise<void>((resolve, reject) => {
      out.on("error", reject);
      out.end(() => resolve());
    });
    return total;
  } catch (err) {
    out.destroy();
    await rm(dest, { force: true }).catch(() => {});
    throw err;
  }
}
