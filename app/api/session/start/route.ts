import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { apiError } from "@/lib/api/error";
import { localDay } from "@/lib/local-day";
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
  if (preview.lesson && preview.lesson.preparation !== "ready") {
    return apiError(
      "lesson_not_prepared",
      "Today's lesson is still being prepared. Start remains available as soon as it is ready.",
      409,
    );
  }
  openSession(db, localDay());
  return NextResponse.json(buildSessionView(db));
}
