import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildLearnItems } from "@/lib/learn-items";

// Today's composer-chosen grammar and vocabulary items to practise (E-32). Each is
// an openable micro-lesson, annotated with an honest price ("Ready" once generated,
// an estimate before). No model calls; the only write is the composer's idempotent
// spill reconciliation (the buildToday precedent).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildLearnItems(getDb()));
}
