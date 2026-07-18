import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createCardForFinding } from "@/lib/cards";

// Pin a phrasebook entry into the flashcard deck (E-9). Ensures a card exists for
// the finding and clears any prior delete-tombstone (createCardForFinding) — so an
// entry the user removed from their deck can be deliberately added back. Idempotent
// (pinning twice leaves exactly one card, schedule untouched). Unknown finding →
// 404. Never touches the SM-2 scheduler, bulk generate, or the grade/due flow.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const card = createCardForFinding(getDb(), findingId);
  if (!card) return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  return NextResponse.json({ inDeck: true, cardId: card.id });
}
