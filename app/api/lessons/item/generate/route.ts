import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { itemExists } from "@/lib/knowledge/items";
import { authoredLessonFor, getItemLesson, itemLessonKind } from "@/lib/lessons/item-lessons";

// Compatibility read for the demoted standalone lesson browser. Despite the legacy
// path name, this route performs no generation: it reads a prepared v2 cache body or
// returns authored Italian in memory. Daily billable preparation belongs only to
// /api/session/prepare before Start is enabled.
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

  const cached = getItemLesson(db, itemId);
  const lesson = cached ?? authoredLessonFor(db, itemId);
  return NextResponse.json({ lesson, cached: cached !== null });
}
