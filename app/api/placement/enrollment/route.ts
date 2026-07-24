import path from "node:path";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import {
  ensureEnrollmentDir,
  enrollmentPath,
  removeEnrollmentFile,
  streamToFile,
  UploadTooLargeError,
} from "@/lib/audio-storage";
import { FfprobeError, probeDurationSeconds } from "@/lib/ffprobe";
import { isSupportedFormat, maxUploadBytes, SUPPORTED_FORMATS } from "@/lib/sessions";
import { latestEnrollment, newEnrollmentId, recordEnrollment } from "@/lib/placement/enrollment";

// The ~45 s enrollment take (E-35, D-22). The bytes are streamed to disk under
// data/enrollment/ — ON-DEVICE ONLY, never uploaded, hosted, or analyzed — and a
// metadata row is recorded for E-36's speaker attribution. This is deliberately NOT
// the session path: an enrollment take is a voice sample, not speech to correct, so
// it creates no session, no ingest job, and yields no findings. Re-recording just
// adds a newer take (GET returns the current one).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current enrollment take (metadata only — never the audio), or null. */
export function GET() {
  const take = latestEnrollment(getDb());
  return NextResponse.json({ enrolled: take !== null, take });
}

export async function POST(request: Request) {
  const rawName = request.headers.get("x-filename");
  const filename = rawName ? decodeURIComponent(rawName).trim() : "enrollment.wav";
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!isSupportedFormat(ext)) {
    return apiError("unsupported_format", `Unsupported format. Accepted: ${SUPPORTED_FORMATS.join(", ")}.`, 415);
  }
  if (!request.body) {
    return apiError("empty_body", "Request body is empty.", 400);
  }

  const id = newEnrollmentId();
  await ensureEnrollmentDir();
  const dest = enrollmentPath(id, ext);

  let sizeBytes: number;
  try {
    sizeBytes = await streamToFile(request.body as WebReadableStream<Uint8Array>, dest, maxUploadBytes());
  } catch (err) {
    await removeEnrollmentFile(dest);
    if (err instanceof UploadTooLargeError) {
      return apiError("too_large", `File exceeds the ${maxUploadBytes()}-byte upload limit.`, 413);
    }
    throw err;
  }

  if (sizeBytes === 0) {
    await removeEnrollmentFile(dest);
    return apiError("empty_upload", "The enrollment take is empty.", 400);
  }

  let durationSeconds: number;
  try {
    durationSeconds = await probeDurationSeconds(dest);
  } catch (err) {
    await removeEnrollmentFile(dest);
    if (err instanceof FfprobeError) return apiError("undecodable_audio", err.message, 422);
    throw err;
  }

  const take = recordEnrollment(getDb(), { id, path: dest, format: ext, durationSeconds, sizeBytes });
  return NextResponse.json({ enrolled: true, take }, { status: 201 });
}
