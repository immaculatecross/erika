import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listAllFindings } from "@/lib/analysis/findings";
import { derivePatterns } from "@/lib/lessons/patterns";
import { generateLessonForPattern } from "@/lib/lessons/generate";
import { openAiTextModel } from "@/lib/lessons/text-model";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { lessonModelErrorResponse } from "../errors";

// Generate (or return the cached) lesson for a recurring pattern (E-6, D-10).
// This is a billable text-model call, so the budget cap is enforced inside
// `generateLessonForPattern` (before any call) — a cache hit bills nothing. POST
// only; the body names the pattern by key. The real client is used here; every
// unit test drives the engine with a mock instead.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { patternKey?: unknown };
  const patternKey = typeof body.patternKey === "string" ? body.patternKey : "";
  const pattern = derivePatterns(listAllFindings(db)).find((p) => p.key === patternKey);
  if (!pattern) return NextResponse.json({ error: "No such recurring pattern." }, { status: 404 });

  try {
    const { lesson, cached } = await generateLessonForPattern(db, openAiTextModel, pattern);
    return NextResponse.json({ lesson, cached });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    return lessonModelErrorResponse(err);
  }
}
