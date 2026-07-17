import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getDb } from "@/lib/db";
import { sourcePath } from "@/lib/audio-storage";
import { AUDIO_MIME, getSession, isSupportedFormat } from "@/lib/sessions";

// Streams a session's source audio with HTTP Range support so seeking works on
// long files. The file is read in a range slice (createReadStream {start,end})
// and piped out — never read whole into memory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Node ReadStream → web stream. The two ReadableStream types (DOM vs
// node:stream/web) are structurally the same but nominally distinct in TS.
function toBody(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(request: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(getDb(), id);
  if (!session || !isSupportedFormat(session.format)) {
    return new Response("Not found", { status: 404 });
  }

  const file = sourcePath(id, session.format);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const contentType = AUDIO_MIME[session.format];
  const range = request.headers.get("range");

  if (!range) {
    return new Response(toBody(createReadStream(file)), {
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
    return new Response("Malformed Range", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffix range: bytes=-N → the last N bytes.
    const n = Number(match[2]);
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }

  if (start > end || start >= size) {
    return new Response("Range Not Satisfiable", {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  }

  return new Response(toBody(createReadStream(file, { start, end })), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
