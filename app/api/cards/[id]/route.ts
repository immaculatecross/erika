import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { deleteCard } from "@/lib/cards";

// Delete one card from the browser (E-5b). The card is removed and its finding is
// tombstoned so a later generate won't resurrect it (see lib/cards deleteCard).
// Unknown card → 404 so the browser can tell a stale row from a real deletion.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  if (!deleteCard(getDb(), id)) {
    return NextResponse.json({ error: "Card not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
