import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getDb } from "@/lib/db";
import { getRendition } from "@/lib/render/renditions";

// Streams a finding's rendered correction clip (E-21), with HTTP Range support so
// the Compare control can play it back cleanly. Orphan-safe: a rendition row whose
// file has been removed (a session delete that cleaned rows but not this file, or a
// half-written generation) answers 404 rather than crashing — no dangling playback.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

// Node ReadStream → web stream (structurally identical, nominally distinct in TS).
function toBody(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const rendition = getRendition(getDb(), findingId);
  if (!rendition) return new Response("Not found", { status: 404 });

  let size: number;
  try {
    size = (await stat(rendition.path)).size;
  } catch {
    // The row exists but the file is gone — orphan-safe, not a crash.
    return new Response("Not found", { status: 404 });
  }

  const contentType = "audio/mpeg";
  const range = request.headers.get("range");

  if (!range) {
    return new Response(toBody(createReadStream(rendition.path)), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response("Malformed Range", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  let start: number;
  let end: number;
  if (match[1] === "") {
    const n = Number(match[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start > end || start >= size) {
    return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }

  return new Response(toBody(createReadStream(rendition.path, { start, end })), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
