import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildOnboardingView } from "@/lib/onboarding/requirements";
import { markOnboardingComplete } from "@/lib/onboarding/state";

// First run, as an API (E-46 criteria 1 and 2).
//
// GET  — what Erika needs, with the key requirement actually CHECKED rather than
//        asserted. The key itself is never returned, only whether one is present.
// POST — the learner has walked out of onboarding. This is the marker the routing
//        gate reads, and it is written whatever the vocabulary check concluded: a
//        run refused as unmeasurable writes no placement run and seeds no evidence
//        by design, so keying the gate on the placement's writes alone would hold
//        exactly that learner in onboarding forever.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildOnboardingView(getDb()));
}

export function POST() {
  const db = getDb();
  const completedAt = markOnboardingComplete(db);
  return NextResponse.json({ complete: true, completedAt });
}
