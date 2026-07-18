import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildPlan } from "@/lib/plan";

// The daily plan read route (E-18 criterion 1): the due-card count, the one
// lesson Focus's ranking prescribes next, and whether this week's letter is
// still unread. Pure composition over existing models — no model calls, no
// writes (the Practice page still POSTs /api/cards/generate first, as before).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildPlan(getDb()));
}
