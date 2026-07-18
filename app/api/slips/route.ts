import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildSlipsIndex } from "@/lib/slips";

// The slips index route (E-20). Materializes the deterministic clustering (one
// recurring mistake = one slip) and serves every slip with its computed state and
// the resolved/remission/active counts. No model calls. GET only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildSlipsIndex(getDb()));
}
