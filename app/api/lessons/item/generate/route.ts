import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { itemExists } from "@/lib/knowledge/items";
import { generateItemLesson, itemLessonKind } from "@/lib/lessons/item-lessons";
import { openAiTextModel } from "@/lib/lessons/text-model";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { lessonModelErrorResponse } from "../../errors";

// Generate (or return the cached) micro-lesson for a composer-chosen knowledge item
// (E-32, D-10/D-18/D-23). A billable text-model call, so the budget cap is enforced
// inside `generateItemLesson` (reserve-before-call) — a cache hit bills nothing.
// POST only; the body names the item by id. The real client is used here; every
// unit test drives the engine with a mock instead.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { itemId?: unknown };
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId || itemLessonKind(itemId) === null) {
    return NextResponse.json({ error: "A grammar or vocabulary item id is required." }, { status: 400 });
  }
  if (!itemExists(db, itemId)) {
    return NextResponse.json({ error: "No such knowledge item." }, { status: 404 });
  }

  try {
    const { lesson, cached } = await generateItemLesson(db, openAiTextModel, itemId);
    return NextResponse.json({ lesson, cached });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    return lessonModelErrorResponse(err);
  }
}
