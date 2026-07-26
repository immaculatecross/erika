import { NextResponse } from "next/server";
import { BudgetExceededError } from "@/lib/render/engine";
import { TtsModelUnavailableError } from "@/lib/render/tts-model";
import { classifyFailure, noticeFor } from "@/lib/session/notices";

// Shared error → HTTP mapping for the three routes that speak a phrase aloud
// (renditions, shadow, reading), the sibling of `app/api/lessons/errors.ts`.
//
// [v0.7 close sweep] All three used to answer every TTS failure with one sentence:
// "The voice model is unavailable right now." On a keyless machine — which is how
// every user arrives, before they have configured anything — that condition is
// PERMANENT until the operator edits a file and restarts, so "right now" was false,
// and the surfaces rendered it beside a retry that could never succeed. This is the
// v0.6 defect E-44 deleted inside the daily session and nowhere else.
//
// The fix is not new copy here. It is that the route now says WHICH condition it hit,
// from the one shared vocabulary, and the surface renders the notice — with its link
// and its retry decided by `lib/session/notices.ts` rather than by each button.
export function voiceFailureResponse(err: unknown): NextResponse {
  const budgetExceeded = err instanceof BudgetExceededError;
  if (!budgetExceeded && !(err instanceof TtsModelUnavailableError)) throw err;
  const notice = classifyFailure({
    budgetExceeded,
    keyConfigured: Boolean(process.env.OPENAI_API_KEY),
    message: (err as Error).message,
    transient: "voice-transient",
  });
  // The status codes are unchanged: 402 is the truthful cap refusal every caller
  // already knows, 502 is an upstream failure. What is new is `notice`.
  return NextResponse.json(
    { error: noticeFor(notice).body, notice },
    { status: budgetExceeded ? 402 : 502 },
  );
}
