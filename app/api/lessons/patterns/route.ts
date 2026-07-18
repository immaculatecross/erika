import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listIncludedFindings } from "@/lib/findings-model";
import { derivePatterns, PATTERN_THRESHOLD } from "@/lib/lessons/patterns";
import { getLessonByPattern } from "@/lib/lessons/lessons";
import { getMastery } from "@/lib/lessons/mastery";
import { lessonEstimateUsd } from "@/lib/lessons/estimate";

// The recurring-error patterns for the lesson engine (E-6). Pure derivation over
// existing findings — a category with >= PATTERN_THRESHOLD findings — annotated
// with whether a lesson has already been generated (a cache hit on open), the
// pattern's current mastery, and — for a lesson not yet generated — its estimated
// generation cost (E-18 criterion 5, display only). No model calls, no writes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const patterns = derivePatterns(listIncludedFindings(db)).map((p) => {
    const hasLesson = getLessonByPattern(db, p.key) !== null;
    return {
      key: p.key,
      category: p.category,
      count: p.count,
      hasLesson,
      mastery: getMastery(db, p.key),
      estimateUsd: hasLesson ? null : lessonEstimateUsd(db, p),
    };
  });
  return NextResponse.json({ patterns, threshold: PATTERN_THRESHOLD });
}
