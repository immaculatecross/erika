import { NextResponse } from "next/server";

// The one error envelope for the D-25 API boundary (E-24): every error a JSON
// /api route returns is `{ error: { code, message } }` — a stable machine code
// and a human, quiet, exact message (DESIGN copy rules apply). New and changed
// routes in a PR adopt this; the repo-wide sweep of the ~30 older routes that
// still return `{ error: "string" }` is its own milestone (E-39), not a rider
// on every feature.

export interface ApiErrorBody {
  error: { code: string; message: string };
}

/** A JSON error response in the boundary envelope. */
export function apiError(code: string, message: string, status: number) {
  return NextResponse.json<ApiErrorBody>({ error: { code, message } }, { status });
}
