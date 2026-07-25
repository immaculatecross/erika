import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Duration comes from the system ffprobe (D-7 — no bundled binary). This is
// also the real decodability check: a file that lands on disk but is not audio
// makes ffprobe fail, which we surface truthfully.

/** Thrown when ffprobe is missing, fails, or reports no usable duration. */
export class FfprobeError extends Error {}

/** Probe a media file's duration in seconds. Throws FfprobeError on failure. */
export async function probeDurationSeconds(filePath: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]));
  } catch {
    throw new FfprobeError(
      "Could not read the audio. The file is not decodable, or ffprobe is unavailable.",
    );
  }
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new FfprobeError("Could not determine a valid audio duration.");
  }
  return seconds;
}

/**
 * The container's `creation_time` tag — when the recording DEVICE says it started
 * (E-39 §B2). Returns the raw tag text, or null when the file carries none.
 *
 * Unlike duration this is never an error: most formats simply do not carry it, and a
 * missing capture time is a normal, honest answer (`lib/capture-time.ts`). A file that
 * would not decode at all has already failed `probeDurationSeconds`, so an ffprobe
 * failure here is treated as "no tag" rather than surfaced twice.
 */
export async function probeCreationTime(filePath: string): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags=creation_time",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]));
  } catch {
    return null;
  }
  const tag = stdout.trim();
  return tag === "" ? null : tag;
}
