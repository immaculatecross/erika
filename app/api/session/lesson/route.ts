import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api/error";
import { localDay } from "@/lib/local-day";
import { authoredLessonFor, getItemLesson } from "@/lib/lessons/item-lessons";
import { buildSessionView, syllabusFallback } from "@/lib/session/view";

// Today's PREPARED lesson. This route serves both the explanation and drills, but it
// cannot generate, reserve money, or write a cache body. The Learn home has already
// resolved the one-lesson-ahead slot through /api/session/prepare before Start.
//
// Every normal session read returns the completed v2 cache body. A direct/legacy read
// before preparation still gets a complete authored Italian lesson in memory, never a
// provider call; that is a safety net, not a first-open generation path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const day = localDay();
  const view = buildSessionView(db, day);
  if (!view.lesson) {
    return apiError("no_lesson", "Today's session has no lesson step.", 404);
  }

  const { itemId, kind, label } = view.lesson;
  const lesson = getItemLesson(db, itemId) ?? authoredLessonFor(db, itemId);
  const fallback = syllabusFallback(lesson.itemId);
  return NextResponse.json({ itemId, kind, label, lesson, fallback, notice: null });
}
