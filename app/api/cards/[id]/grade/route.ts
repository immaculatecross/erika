import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCard, gradeCard, toCardView } from "@/lib/cards";
import { isGrade } from "@/lib/cards-view";

// Grade one card (E-5): the runner POSTs { grade: "again" | "hard" | "good" |
// "easy" }, the pure SM-2 scheduler advances it, and the new schedule is
// persisted. Returns the card view plus the updated schedule so a caller (or a
// test) can confirm the grade landed. Unknown card → 404; bad grade → 400.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  if (!getCard(db, id)) return NextResponse.json({ error: "Card not found." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { grade?: unknown };
  if (!isGrade(body.grade)) {
    return NextResponse.json({ error: "grade must be one of: again, hard, good, easy." }, { status: 400 });
  }

  const card = gradeCard(db, id, body.grade);
  return NextResponse.json({
    card: toCardView(card),
    schedule: {
      ease: card.ease,
      intervalDays: card.intervalDays,
      repetitions: card.repetitions,
      due: card.due,
      lastGrade: card.lastGrade,
    },
  });
}
