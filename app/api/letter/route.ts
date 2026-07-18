import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildLetter } from "@/lib/letter";

// The editor's letter read route (E-12). Pure weekly aggregation over existing
// findings, segments and analysis jobs — the coaching layer, no model calls, no
// writes. Serves the most recent week with findings, or an optionally named week
// (?week=YYYY-MM-DD). A null letter means nothing has been analyzed yet. GET only.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const week = new URL(request.url).searchParams.get("week") ?? undefined;
  return NextResponse.json({ letter: buildLetter(getDb(), week) });
}
