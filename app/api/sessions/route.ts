import path from "node:path";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import {
  ensureSessionDir,
  removeSessionDir,
  sourcePath,
  streamToFile,
  UploadTooLargeError,
} from "@/lib/audio-storage";
import { finalizeStagedUpload, UploadRejected } from "@/lib/finalize-upload";
import { isSupportedFormat, maxUploadBytes, newSessionId, SUPPORTED_FORMATS } from "@/lib/sessions";
import { listSessionItems } from "@/lib/session-yield";

// The streamed ingestion entry point — now the FALLBACK to the tus resumable
// upload (E-24). The body is streamed to disk, never buffered: a client sends
// the raw file bytes with an x-filename header, not multipart FormData
// (request.formData() would read the whole file into memory). Once the bytes are
// on disk this hands off to the SAME finalizeStagedUpload the tus completion
// hook uses, so both paths yield an identical session + queued ingest job.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    return apiError("filename_required", "A filename is required (x-filename header).", 400);
  }
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!isSupportedFormat(ext)) {
    return apiError(
      "unsupported_format",
      `Unsupported format. Accepted: ${SUPPORTED_FORMATS.join(", ")}.`,
      415,
    );
  }
  if (!request.body) {
    return apiError("empty_body", "Request body is empty.", 400);
  }

  // Mint the id, stage the bytes under it, then finalize. Any failure past this
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
      return apiError("too_large", `File exceeds the ${maxUploadBytes()}-byte upload limit.`, 413);
    }
    throw err;
  }

  try {
    const session = await finalizeStagedUpload({ id, filename, format: ext, sourceFile: dest, sizeBytes });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    if (err instanceof UploadRejected) return apiError(err.code, err.message, err.status);
    throw err;
  }
}
