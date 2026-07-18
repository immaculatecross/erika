import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listIncludedFindingsWithSession } from "@/lib/findings-model";
import { buildEntries, CATEGORY_ORDER, SEVERITY_ORDER } from "@/lib/archive";

// The Speech archive read route (E-11). Pure view over existing findings joined
// to their session date — the whole speaking timeline, newest session first. No
// model calls, no writes. GET only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const entries = buildEntries(listIncludedFindingsWithSession(db));
  return NextResponse.json({ entries, categories: CATEGORY_ORDER, severities: SEVERITY_ORDER });
}
