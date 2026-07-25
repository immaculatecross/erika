import { NextResponse } from "next/server";
import { TtsModelNotConfiguredError, TtsModelUnavailableError } from "@/lib/render/tts-model";
import {
  TextModelNotConfiguredError,
  TextModelParseError,
  TextModelUnavailableError,
} from "@/lib/lessons/text-model";
import { isRetryableCause, modelNotConfiguredMessage, type ModelFailureCause } from "@/lib/env-file";

// [E-39 §B3] The one place a model failure becomes a sentence for the learner.
//
// THE INVARIANT: a failure tells the truth about its own permanence, and every failure
// branch offers the action that resolves it. Six routes each answered "… is unavailable
// right now" for BOTH a transient blip and a permanent "no key is configured here". On
// the shipped default that copy is false, and it came with no retry control — so a
// person retried until they gave up, and the one thing that would have fixed it was
// never named. The standard being matched is `analysisUnavailableMessage`
// (lib/env-file.ts, RETRO-004 §DE-1): name the cause, say it is permanent until you act,
// give the exact fix.
//
// Only the SERVER knows which cause it was, so the cause and a `retryable` verdict travel
// in the envelope and the client renders the copy and the control each one earns.

/** The error envelope every model-backed route answers with. `error` is what to show. */
export interface ModelErrorBody {
  error: string;
  cause: ModelFailureCause;
  /** Whether "Try again" can possibly succeed. False for a missing key. */
  retryable: boolean;
}

export function modelErrorBody(cause: ModelFailureCause, error: string): ModelErrorBody {
  return { error, cause, retryable: isRetryableCause(cause) };
}

/**
 * TTS failures, for every surface that plays a rendered phrase (the shadow drill, the
 * studio's reference line, the reading passage, a contrastive rendition).
 *
 * `503` for not-configured, deliberately: it is this server's state, not the upstream's,
 * and a 502 would say the vendor failed when nothing was ever sent.
 */
export function voiceModelErrorResponse(err: unknown): NextResponse {
  // Order matters: the not-configured error is a SUBCLASS of the unavailable one.
  if (err instanceof TtsModelNotConfiguredError) {
    return NextResponse.json(
      modelErrorBody("not-configured", modelNotConfiguredMessage("the spoken voice")),
      { status: 503 },
    );
  }
  if (err instanceof TtsModelUnavailableError) {
    return NextResponse.json(
      modelErrorBody("unavailable", "The voice could not be reached. This is usually temporary."),
      { status: 502 },
    );
  }
  throw err;
}

/** Ask-Erika failures (a text-model surface with its own voice in the copy). */
export function askModelErrorResponse(err: unknown): NextResponse {
  if (err instanceof TextModelNotConfiguredError) {
    return NextResponse.json(modelErrorBody("not-configured", modelNotConfiguredMessage("Ask Erika")), {
      status: 503,
    });
  }
  if (err instanceof TextModelParseError) {
    return NextResponse.json(
      modelErrorBody("unreadable", "Erika's note came back unreadable. Trying again often works."),
      { status: 502 },
    );
  }
  if (err instanceof TextModelUnavailableError) {
    return NextResponse.json(
      modelErrorBody("unavailable", "Erika could not be reached. This is usually temporary."),
      { status: 502 },
    );
  }
  throw err;
}
