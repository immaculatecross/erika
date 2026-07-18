import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listCards, listDueCards, toCardBrowserView, toCardView } from "@/lib/cards";

// The cards read route (E-5). `?due=1` returns the practice due queue — cards due
// now and not suspended, most overdue first — as the client-safe drill view plus
// its count. With no `due` param it returns *all* cards (E-5b's browser), soonest
// due first, each carrying its due date and suspended state. GET only — no mutation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const db = getDb();
  if (new URL(request.url).searchParams.get("due") === "1") {
    const cards = listDueCards(db).map(toCardView);
    return NextResponse.json({ cards, dueCount: cards.length });
  }
  return NextResponse.json({ cards: listCards(db).map(toCardBrowserView) });
}
