import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { prepareItemLesson } from "@/lib/lessons/item-lessons";
import { openAiTextModel } from "@/lib/lessons/text-model";
import { buildSessionView } from "@/lib/session/view";
import { textModelReachable } from "@/lib/session/plan";

// The one-lesson-ahead trigger. The Learn home calls this as soon as the composer
// exposes today's selected item. It is the ONLY daily-session route allowed to
// generate: /api/session/lesson and the session runner are read-only consumers.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const db = getDb();
  const view = buildSessionView(db);
  if (!view.lesson) {
    return apiError("no_lesson", "Today's session has no lesson to prepare.", 404);
  }

  const reachable = textModelReachable(db);
  const prepared = await prepareItemLesson(
    db,
    reachable.ok ? openAiTextModel : null,
    view.lesson.itemId,
  );

  return NextResponse.json(
    {
      state: prepared.state,
      selectedItemId: view.lesson.itemId,
      servedItemId: prepared.lesson?.itemId ?? null,
      source: prepared.lesson?.deterministic ? "authored" : prepared.lesson ? "generated" : null,
    },
    { status: prepared.state === "preparing" ? 202 : 200 },
  );
}
