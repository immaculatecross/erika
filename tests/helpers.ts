import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Test fixtures for the capture backbone. We generate real, decodable audio
// with the system ffmpeg (the same D-7 prerequisite the app relies on) rather
// than committing a binary, so ffprobe genuinely reads it.

export function tmpDir(prefix = "erika-test-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Write a real WAV of `seconds` (default 1) to `dest`; returns its byte size. */
export function makeWav(dest: string, seconds = 1): number {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=440:duration=${seconds}`,
    "-ac",
    "1",
    "-ar",
    "8000",
    dest,
  ], { stdio: "ignore" });
  return fs.statSync(dest).size;
}

/** A web ReadableStream that emits `bytes` in small chunks (like a real upload). */
export function streamOf(bytes: Uint8Array, chunkSize = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}
