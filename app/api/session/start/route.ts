import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api/error";
import { localDay } from "@/lib/local-day";
import { pinServableItemLesson } from "@/lib/lessons/lesson-serving";
import { openSession } from "@/lib/session/store";
import { buildSessionView } from "@/lib/session/view";

// Open today's session (E-44). A POST, because it records a durable user-visible fact
// — the E-18 letter-viewed lesson, applied.
//
// Idempotent by construction (the `local_day` PK): pressing Start twice, or two tabs
// racing, opens exactly one session and the second call plans nothing. The plan is
// FROZEN here and never recomputed, so what the home promised is what the learner
// walks — see `lib/migrations/v30-daily-sessions.ts` for why that matters.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function POST() {
  const db = getDb();
  const preview = buildSessionView(db);
  if (preview.lesson && !pinServableItemLesson(db, preview.lesson.itemId)) {
    return apiError(
      "lesson_not_servable",
      "Today's lesson is not available yet.",
      409,
    );
  }
  openSession(db, localDay());
  return NextResponse.json(buildSessionView(db));
}
