import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

// Stream an on-disk audio file as an HTTP response with Range support (E-33). The
// same behaviour the E-21 renditions audio route hand-rolls, factored out so the new
// phrase-render audio routes (shadow, reading) reuse it rather than copy it. Orphan-
// safe: a missing file answers 404 rather than crashing (the file may be evicted
// while its row lives, the segment-cache precedent). Server-only (node streams).

// Node ReadStream → web stream (structurally identical, nominally distinct in TS).
function toBody(stream: Readable): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>;
}

/** Stream `path` as `contentType` (default audio/mpeg) honoring a Range header. A
 *  missing file → 404; a malformed/unsatisfiable range → 416. */
export async function audioFileResponse(
  request: Request,
  path: string,
  contentType = "audio/mpeg",
): Promise<Response> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }

  const range = request.headers.get("range");
  if (!range) {
    return new Response(toBody(createReadStream(path)), {
      status: 200,
      headers: { "Content-Type": contentType, "Content-Length": String(size), "Accept-Ranges": "bytes" },
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

  return new Response(toBody(createReadStream(path, { start, end })), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
