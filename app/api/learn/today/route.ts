import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildToday } from "@/lib/today";

// The Learn TODAY read route (E-31, extended by E-38). Serves the composed daily plan
// reduced to the Learn home's calm surface: the goal ring, the completion state, the
// review row, the one lesson row, the composer's new-item counts, and (E-38) the
// streak, the map strip and today's thread. No model calls.
//
// This GET performs exactly TWO idempotent writes, both following the slips read-path
// materialization precedent and neither touching money, findings or evidence:
//   · the composer's spill-queue reconciliation (E-31), and
//   · the streak's repair ledger — `buildStreak` may INSERT OR IGNORE one
//     `streak_repairs` row for a past missed day it bridges (E-38; the reasoning is at
//     the top of lib/streak/store.ts). Silent and automatic: nothing is shown, asked,
//     or charged, and the `local_day` PK means recomputing can never double-spend.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildToday(getDb()));
}
