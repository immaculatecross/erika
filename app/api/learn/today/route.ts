import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildToday } from "@/lib/today";

// The Learn TODAY read route (E-31). Serves the composed daily plan reduced to the
// Learn home's calm surface: the goal ring, the completion state, the review row,
// the one lesson row, and the composer's new-item counts. No model calls. The only
// write is the composer's idempotent spill-queue reconciliation (the slips
// read-path materialization precedent), never money/findings/evidence.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildToday(getDb()));
}
