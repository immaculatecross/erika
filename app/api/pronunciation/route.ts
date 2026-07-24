import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildStudioView, resolvePronunciationScorer } from "@/lib/pronunciation";

// The pronunciation studio's list (E-37, D-21). Pronunciation signal from the
// learner's own recordings — the `pronunciation` finding category AND the
// `notes.pronunciation` richness channel — becomes a correct line to hear and say
// back, with the `phone:` items today's composer put at their edge beside them.
//
// Read-only: no model calls, no money, and no secret. `scoringAvailable` is a boolean
// derived from whether the server has an Azure key, never the key itself (WO criterion
// 6) — and false only hides the optional scoring control, never the drills.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const scoringAvailable = resolvePronunciationScorer().isAvailable();
  return NextResponse.json(buildStudioView(getDb(), { scoringAvailable }));
}
