import { NextResponse } from "next/server";
import { TextModelParseError, TextModelUnavailableError } from "@/lib/lessons/text-model";

// Shared error → HTTP mapping for the billable lesson routes (generate, grade).
// A malformed model reply or an unavailable/unauthorized endpoint is an upstream
// (502) failure, reported truthfully without leaking the API key or internals.
// Budget refusals (402) stay in each route since they carry a user-facing message.
export function lessonModelErrorResponse(err: unknown): NextResponse {
  if (err instanceof TextModelParseError) {
    return NextResponse.json({ error: "The lesson model returned an unreadable response." }, { status: 502 });
  }
  if (err instanceof TextModelUnavailableError) {
    return NextResponse.json({ error: "The lesson model is unavailable right now." }, { status: 502 });
  }
  throw err;
}
