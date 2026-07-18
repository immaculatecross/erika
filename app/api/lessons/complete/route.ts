import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { recordCompletion } from "@/lib/lessons/mastery";

// Record a lesson completion and update the pattern's mastery (E-6, criterion 5).
// No model call, no cost — a pure state update by the documented EMA rule. The
// `score` is the fraction of exercises answered correctly (0..1); the interactive
// runner that computes and posts it is part 2 (E-6b). POST only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { patternKey?: unknown; score?: unknown };
  const patternKey = typeof body.patternKey === "string" ? body.patternKey : "";
  const score = typeof body.score === "number" ? body.score : NaN;
  if (!patternKey || !Number.isFinite(score) || score < 0 || score > 1) {
    return NextResponse.json({ error: "patternKey and a score between 0 and 1 are required." }, { status: 400 });
  }

  const mastery = recordCompletion(db, patternKey, score);
  return NextResponse.json({ patternKey, mastery });
}
