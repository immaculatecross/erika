import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listShadowDrills } from "@/lib/shadow";

// The listen-and-shadow drill list (E-33, D-18). Each drill's target is a finding's
// CORRECT correction — never the learner's error (lib/shadow.ts enforces it). Read
// through the canonical findings model (E-17); no model calls here.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ drills: listShadowDrills(getDb()) });
}
