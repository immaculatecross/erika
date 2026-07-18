import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listIncludedFindings } from "@/lib/findings-model";
import { derivePatterns, PATTERN_THRESHOLD } from "@/lib/lessons/patterns";
import { getLessonByPattern } from "@/lib/lessons/lessons";
import { getMastery } from "@/lib/lessons/mastery";

// The recurring-error patterns for the lesson engine (E-6). Pure derivation over
// existing findings — a category with >= PATTERN_THRESHOLD findings — annotated
// with whether a lesson has already been generated (a cache hit on open) and the
// pattern's current mastery. No model calls, no writes. GET only. The interactive
// lesson surface that consumes this is part 2 (E-6b).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const patterns = derivePatterns(listIncludedFindings(db)).map((p) => ({
    key: p.key,
    category: p.category,
    count: p.count,
    hasLesson: getLessonByPattern(db, p.key) !== null,
    mastery: getMastery(db, p.key),
  }));
  return NextResponse.json({ patterns, threshold: PATTERN_THRESHOLD });
}
