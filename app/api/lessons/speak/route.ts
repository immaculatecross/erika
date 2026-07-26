import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { BudgetExceededError } from "@/lib/lessons/billing";
import {
  DrillAnswerTooLargeError,
  openAiSpeechToText,
  SpeechUnavailableError,
  transcribeDrillAnswer,
} from "@/lib/lessons/speech";

// Transcribe ONE spoken drill answer (E-45 criterion 2, D-28). The learner said a
// word; this returns what the recogniser heard. It does not grade — grading is
// deterministic, free and client-side (lib/lessons/spoken-answer.ts), so no billed
// call ever decides whether a learner was right.
//
// Why the route hands back the transcript rather than a verdict: the learner has to
// SEE what was heard. "Not quite" with no explanation, when they actually said the
// right thing, is the failure this whole design is arranged against; "I heard: *il
// problema*" is a fact they can judge for themselves, and it is what makes the
// "that is not what I said" control honest rather than a shrug.
//
// Every failure here is a soft failure. The client falls back to tapping, which
// every drill supports, so no answer path can end at a wall (D-26).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Refusals a learner can act on: keep tapping. Never a 500, never a dead end. */
function unavailable(reason: string) {
  return NextResponse.json({ heard: null, reason }, { status: 200 });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    audioBase64?: unknown;
    format?: unknown;
    seconds?: unknown;
    drillKey?: unknown;
  };
  const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
  const format = typeof body.format === "string" && body.format ? body.format : "wav";
  const seconds = typeof body.seconds === "number" && Number.isFinite(body.seconds) ? body.seconds : 0;
  const drillKey = typeof body.drillKey === "string" && body.drillKey ? body.drillKey : "drill";
  if (!audioBase64) {
    return NextResponse.json({ error: { code: "bad_request", message: "Audio is required." } }, { status: 400 });
  }

  try {
    const { text } = await transcribeDrillAnswer(getDb(), openAiSpeechToText, {
      audioBase64,
      format,
      seconds,
      drillKey,
    });
    return NextResponse.json({ heard: text, reason: null });
  } catch (err) {
    if (err instanceof BudgetExceededError) return unavailable("budget");
    if (err instanceof SpeechUnavailableError) return unavailable("unavailable");
    // Too much audio is a refusal, not a crash — and the learner still has the
    // options in front of them, so it degrades like every other failure here.
    if (err instanceof DrillAnswerTooLargeError) return unavailable("too_long");
    throw err;
  }
}
