import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateCards } from "@/lib/cards";

// Turn every analysis finding into a flashcard, once (E-5). Idempotent: a finding
// that already has a card is skipped, so the Practice screen can call this on
// every visit to pick up findings from newly analyzed sessions without ever
// duplicating a card. Returns how many were created this call.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const created = generateCards(getDb());
  return NextResponse.json({ created });
}
