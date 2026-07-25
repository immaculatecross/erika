import { NextResponse } from "next/server";
import {
  TextModelNotConfiguredError,
  TextModelParseError,
  TextModelUnavailableError,
} from "@/lib/lessons/text-model";
import { isRetryableCause, modelNotConfiguredMessage, type ModelFailureCause } from "@/lib/env-file";

// Shared error → HTTP mapping for the billable lesson routes (generate, grade).
// A malformed model reply or an unavailable/unauthorized endpoint is an upstream
// (502) failure, reported truthfully without leaking the API key or internals.
// Budget refusals (402) stay in each route since they carry a user-facing message.
//
// [E-39 §B3] Every branch used to answer "The lesson model is unavailable right now."
// On the shipped default — no API key — that is FALSE: the condition is permanent, and
// the copy promised transience with no retry control, so all 13 rows of /practice/learn
// were walls and a person retried every one of them before concluding anything. The
// response now carries the CAUSE and whether a retry could honestly help, because only
// the server knows which of the two it is, and the client has to render different copy
// and a different control for each.

/** The error envelope every lesson route answers with — `error` is the sentence to show. */
export interface ModelErrorBody {
  error: string;
  cause: ModelFailureCause;
  /** Whether "Try again" can possibly succeed. False for a missing key. */
  retryable: boolean;
}

function body(cause: ModelFailureCause, error: string): ModelErrorBody {
  return { error, cause, retryable: isRetryableCause(cause) };
}

export function lessonModelErrorResponse(err: unknown): NextResponse {
  // Order matters: the not-configured error is a SUBCLASS of the unavailable one.
  if (err instanceof TextModelNotConfiguredError) {
    return NextResponse.json(body("not-configured", modelNotConfiguredMessage("lessons")), {
      status: 503,
    });
  }
  if (err instanceof TextModelParseError) {
    return NextResponse.json(
      body("unreadable", "The lesson model returned a reply we could not read. Trying again often works."),
      { status: 502 },
    );
  }
  if (err instanceof TextModelUnavailableError) {
    return NextResponse.json(
      body("unavailable", "The lesson model could not be reached. This is usually temporary."),
      { status: 502 },
    );
  }
  throw err;
}
