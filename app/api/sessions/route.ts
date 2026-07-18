import path from "node:path";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  ensureSessionDir,
  removeSessionDir,
  sourcePath,
  streamToFile,
  UploadTooLargeError,
} from "@/lib/audio-storage";
import { FfprobeError, probeDurationSeconds } from "@/lib/ffprobe";
import {
  createSession,
  isSupportedFormat,
  maxDurationSeconds,
  maxUploadBytes,
  newSessionId,
  SUPPORTED_FORMATS,
} from "@/lib/sessions";
import { listSessionItems } from "@/lib/session-yield";

// The single ingestion entry point (file-upload now; mic-capture posts here in
// E-2 part 2). The body is streamed to disk, never buffered — so a client
// sends the raw file bytes with an x-filename header, not multipart FormData
// (request.formData() would read the whole file into memory).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bad(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// The list serves each session WITH its yield (E-18 criterion 2): analysed speech
// time, findings count and dominant category via the canonical read-model, plus
// the facts the inline-Analyze gate mirrors (segment count, in-flight run).
export function GET() {
  return NextResponse.json(listSessionItems(getDb()));
}

export async function POST(request: Request) {
  const rawName = request.headers.get("x-filename");
  const filename = rawName ? decodeURIComponent(rawName).trim() : "";
  if (!filename) {
    return bad("A filename is required (x-filename header).", 400);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!isSupportedFormat(ext)) {
    return bad(`Unsupported format. Accepted: ${SUPPORTED_FORMATS.join(", ")}.`, 415);
  }
  if (!request.body) {
    return bad("Request body is empty.", 400);
  }

  // Mint the id, stage the bytes under it, then probe. Any failure past this
  // point must leave neither a file nor a row behind.
  const id = newSessionId();
  await ensureSessionDir(id);
  const dest = sourcePath(id, ext);

  let sizeBytes: number;
  try {
    sizeBytes = await streamToFile(
      request.body as WebReadableStream<Uint8Array>,
      dest,
      maxUploadBytes(),
    );
  } catch (err) {
    await removeSessionDir(id);
    if (err instanceof UploadTooLargeError) {
      return bad(`File exceeds the ${maxUploadBytes()}-byte upload limit.`, 413);
    }
    throw err;
  }

  if (sizeBytes === 0) {
    await removeSessionDir(id);
    return bad("The uploaded file is empty.", 400);
  }

  let durationSeconds: number;
  try {
    durationSeconds = await probeDurationSeconds(dest);
  } catch (err) {
    await removeSessionDir(id);
    if (err instanceof FfprobeError) return bad(err.message, 422);
    throw err;
  }

  if (durationSeconds > maxDurationSeconds()) {
    await removeSessionDir(id);
    return bad(`Audio is longer than the ${maxDurationSeconds()}-second (24 h) limit.`, 413);
  }

  const session = createSession(getDb(), {
    id,
    originalFilename: filename,
    format: ext,
    sizeBytes,
    durationSeconds,
  });
  return NextResponse.json(session, { status: 201 });
}
