import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordExerciseEvidence, NoSuchItemError } from "@/lib/lessons/item-evidence";

// Record one completed item-lesson exercise as cued evidence on its knowledge item
// (E-32 criterion 4, D-19). NO model call, no cost — a pure append to the E-25
// evidence log plus the item's derived-state rebuild. The body names the item and
// whether the answer was correct; the polarity and cued mode are set server-side so
// the client cannot mis-weight the signal. POST only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown; correct?: unknown };
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId || typeof body.correct !== "boolean") {
    return NextResponse.json({ error: "itemId and a boolean correct are required." }, { status: 400 });
  }

  try {
    const { evidence, status } = recordExerciseEvidence(db, { itemId, correct: body.correct });
    return NextResponse.json({ itemId, polarity: evidence.polarity, mode: evidence.mode, status });
  } catch (err) {
    if (err instanceof NoSuchItemError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
