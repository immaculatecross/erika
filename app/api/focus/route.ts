import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildFocusPayload } from "@/lib/focus";

// The Focus read route (E-7, +E-20 resolved-slip count). Pure aggregation over
// existing findings, segments and analysis jobs — the coaching layer, no model
// calls, no writes. GET only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(buildFocusPayload(getDb()));
}
