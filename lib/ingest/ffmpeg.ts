import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Thin spawn/collect helpers over the system ffmpeg/ffprobe (D-7). Every audio
// operation in the pipeline is file→file through here: normalize, silencedetect,
// per-interval extraction, and atempo renditions. Nothing decodes a whole
// recording into a Node Buffer, which is what keeps day-scale ingest
// memory-bounded. stderr is captured so failures surface a truthful message.

const run = promisify(execFile);

// silencedetect can emit a lot of lines on a day-long file; give stderr room.
const MAX_STDERR = 32 * 1024 * 1024;

/** Thrown when an ffmpeg/ffprobe invocation exits non-zero. Carries stderr. */
export class FfmpegError extends Error {}

/**
 * Run ffmpeg with `args` and return its stderr (where ffmpeg writes progress
 * and filter output such as silencedetect). Throws FfmpegError with a trimmed
 * stderr tail on non-zero exit. The audio itself flows file→file via the args;
 * this never buffers audio in Node.
 */
export async function runFfmpeg(args: string[]): Promise<string> {
  try {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostdin", ...args], {
      maxBuffer: MAX_STDERR,
    });
    return stderr;
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? "";
    const tail = stderr.trim().split("\n").slice(-3).join(" ").trim();
    throw new FfmpegError(tail || (err as Error).message || "ffmpeg failed.");
  }
}

/** Media duration in seconds via ffprobe. Throws FfmpegError on failure. */
export async function probeDuration(filePath: string): Promise<number> {
  const seconds = await probeField(filePath, "format=duration");
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) throw new FfmpegError("No usable duration.");
  return n;
}

/** A single stream/format field via ffprobe (e.g. "stream=sample_rate"). */
export async function probeField(filePath: string, entry: string): Promise<string> {
  try {
    const { stdout } = await run("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      entry,
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    return stdout.trim().split("\n")[0]?.trim() ?? "";
  } catch (err) {
    throw new FfmpegError((err as Error).message || "ffprobe failed.");
  }
}
