import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCard, suspendCard } from "@/lib/cards";

// Suspend or un-suspend one card from the browser (E-5b): the runner POSTs
// { suspended: boolean }. A suspended card stays out of the practice due queue
// (part-1 behavior); un-suspending returns it to the queue when due. Unknown card
// → 404; a non-boolean `suspended` → 400. Returns the card's new suspended state.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  if (!getCard(db, id)) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { suspended?: unknown };
  if (typeof body.suspended !== "boolean") {
    return NextResponse.json({ error: "suspended must be a boolean." }, { status: 400 });
  }

  suspendCard(db, id, body.suspended);
  return NextResponse.json({ suspended: body.suspended });
}
