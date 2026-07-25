import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api/error";
import { localDay } from "@/lib/local-day";
import { markStepDone } from "@/lib/session/store";
import { completeDayIfMet } from "@/lib/session/day";
import { buildSessionView } from "@/lib/session/view";
import { isStepKey } from "@/lib/session/steps";

// Finish one step of today's session (E-44). POST only — it advances a recorded day.
//
// The write is guarded server-side (`markStepDone`): a step whose truth is durable
// elsewhere is written only when that durable state agrees, so the client cannot claim
// a conversation it did not have or a drill queue it did not clear. A refused claim is
// not an error — the response simply shows the step still open, which is the truth.
//
// When the last step lands, the DAY is recorded complete in the same request, from
// figures derived from durable state (`completeDayIfMet`). That is criterion 4: the
// day is complete when the session is.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { step?: unknown };
  if (!isStepKey(body.step)) {
    return apiError("invalid_step", "step must be one of: lesson, drills, letter, conversation.", 400);
  }

  const day = localDay();
  const session = markStepDone(db, day, body.step);
  if (!session) {
    return apiError("no_session", "Today's session has not been started.", 409);
  }
  completeDayIfMet(db, day);
  return NextResponse.json(buildSessionView(db, day));
}
