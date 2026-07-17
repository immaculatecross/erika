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
