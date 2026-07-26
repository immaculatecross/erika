import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Duration comes from the system ffprobe (D-7 — no bundled binary). This is
// also the real decodability check: a file that lands on disk but is not audio
// makes ffprobe fail, which we surface truthfully.

function positiveSeconds(value: string): number | null {
  const seconds = Number(value.trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

function packetDuration(output: string): number | null {
  let endSeconds = 0;
  for (const line of output.trim().split("\n")) {
    const [rawStart, rawDuration] = line.split(",");
    const start = Number(rawStart);
    const duration = Number(rawDuration);
    if (!Number.isFinite(start)) continue;
    endSeconds = Math.max(endSeconds, start + (Number.isFinite(duration) ? duration : 0));
  }
  return endSeconds > 0 ? endSeconds : null;
}

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
    const containerSeconds = positiveSeconds(stdout);
    if (containerSeconds !== null) return containerSeconds;

    // MediaRecorder's live WebM output is decodable but commonly omits the
    // container-level duration. Derive it from the final audio packet instead.
    ({ stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "a:0",
      "-show_entries",
      "packet=pts_time,duration_time",
      "-of",
      "csv=p=0",
      filePath,
    ]));
  } catch {
    throw new FfprobeError(
      "Could not read the audio. The file is not decodable, or ffprobe is unavailable.",
    );
  }
  const seconds = packetDuration(stdout);
  if (seconds === null) {
    throw new FfprobeError("Could not determine a valid audio duration.");
  }
  return seconds;
}

/**
 * The container's embedded `creation_time` tag, or null (E-42 criterion 5).
 *
 * Phone and field recorders write this into m4a/mp4/mov; most wav and mp3 files
 * carry nothing, which is a normal answer and NOT an error — a missing tag simply
 * means the next capture-time source is used. So unlike `probeDurationSeconds`
 * this NEVER throws: an absent tag, an unreadable file, or a missing ffprobe all
 * return null, because failing to guess when a recording was made must never cost
 * a learner the recording itself.
 */
export async function probeCreationTime(filePath: string): Promise<string | null> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format_tags=creation_time",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const value = stdout.trim();
    return value === "" || value === "N/A" ? null : value;
  } catch {
    return null;
  }
}
