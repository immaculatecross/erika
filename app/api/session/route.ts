import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildSessionView } from "@/lib/session/view";

// Today's session, read (E-44). No model calls, no money.
//
// Like the Learn home's own GET, this performs the composer's idempotent spill
// reconciliation and mints the cards for findings that do not have one — both
// model-free, both on the read-path materialization precedent E-31 set for slips. It
// also folds in any step whose truth lives elsewhere and moved while the learner was
// away (the conversation, above all), so returning from the tutor shows the day as it
// actually is rather than as it was when they left.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildSessionView(getDb()));
}
