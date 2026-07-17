import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listDueCards, toCardView } from "@/lib/cards";

// The due queue the practice runner drills through (E-5). `?due=1` selects the
// cards due now and not suspended, most overdue first; that is the only mode this
// milestone needs (the full card browser is E-5b). The response is the client-safe
// card view plus the count the Practice screen shows. GET only — no mutation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cards = listDueCards(getDb()).map(toCardView);
  return NextResponse.json({ cards, dueCount: cards.length });
}
