import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { completeDayIfMet } from "@/lib/day-ledger";
import { localDay } from "@/lib/local-day";

// Record today complete (E-31, D-24). A POST — recording a completed day is a
// user-visible fact and must not ride a GET (the E-18 letter-viewed lesson).
// AUTHORITATIVE: it recomputes the goal server-side and records the day only if the
// goal is truly met, idempotently (one row per local day, never double-counted).
// Returns the completion figures the one-per-day sentence states, or `complete:false`
// when the goal is not met yet. No model calls.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  const completion = completeDayIfMet(getDb(), localDay());
  if (!completion) return NextResponse.json({ complete: false });
  return NextResponse.json({
    complete: true,
    completion: { cardsDone: completion.cardsDone, lessonsDone: completion.lessonsDone },
  });
}
