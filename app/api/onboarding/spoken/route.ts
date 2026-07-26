import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { listenForPlacement } from "@/lib/onboarding/spoken";
import { isSupportedFormat } from "@/lib/session-types";

// The spoken placement prompt (E-46 criteria 3, 10, 11).
//
// The clip arrives as raw bytes and is judged in memory — it is NOT written to
// `data/`, NOT minted as a session, and NOT the D-22 enrollment take. Those are
// three different things and conflating them would break a promise: the enrollment
// take is stored on-device and never uploaded, while this one is deliberately sent
// to the model, so the two are recorded separately and described separately in the
// UI. The learner is told which is which before either is recorded.
//
// Every failure is reported as a failure. There is no branch here that returns a
// level the model did not give: no key, over the cap, an unreadable reply and a
// sample too thin to judge all come back as themselves, and the vocabulary check
// places the learner on its own (criterion 11).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A minute of speech at a sane bitrate. Beyond this we refuse rather than bill. */
const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(request: Request) {
  const format = request.headers.get("x-audio-format") ?? "";
  if (!isSupportedFormat(format)) {
    return apiError("bad_format", "Send a supported audio format in x-audio-format.", 400);
  }
  const durationMs = Number(request.headers.get("x-duration-ms") ?? "0");
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return apiError("bad_duration", "Send the clip length in milliseconds in x-duration-ms.", 400);
  }

  const buffer = Buffer.from(await request.arrayBuffer());
  if (buffer.byteLength === 0) return apiError("empty", "The take carried no audio.", 400);
  if (buffer.byteLength > MAX_BYTES) return apiError("too_large", "That take is longer than this step needs.", 413);

  const outcome = await listenForPlacement(getDb(), {
    audioBase64: buffer.toString("base64"),
    format,
    durationMs,
  });
  return NextResponse.json(outcome);
}
