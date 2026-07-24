import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildStudioView, resolvePronunciationScorer } from "@/lib/pronunciation";

// The pronunciation studio's list (E-37, D-21). Pronunciation findings from the
// learner's own recordings become scored re-record drills, and the `phone:` items
// today's composer put at their edge appear beside them. Read-only: no model calls, no
// money, and no secret — `available` is a boolean derived from whether the server has
// an Azure key, never the key itself (WO criterion 6).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const available = resolvePronunciationScorer().isAvailable();
  return NextResponse.json(buildStudioView(getDb(), { available }));
}
