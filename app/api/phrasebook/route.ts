import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listIncludedFindings } from "@/lib/findings-model";
import { listCards } from "@/lib/cards";
import { buildEntries, CATEGORY_ORDER } from "@/lib/phrasebook";

// The Phrasebook read route (E-9). Pure view over existing findings — the full
// recast library — annotated with which findings already carry a flashcard so the
// screen can mark "in deck". No model calls, no writes. GET only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const inDeck = new Set(listCards(db).map((c) => c.findingId));
  const entries = buildEntries(listIncludedFindings(db), inDeck);
  return NextResponse.json({ entries, categories: CATEGORY_ORDER });
}
