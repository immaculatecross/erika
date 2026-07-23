import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildLetter } from "@/lib/letter";

// The editor's letter read route (E-12). Pure weekly aggregation over existing
// findings, segments and analysis jobs — the coaching layer, no model calls.
// Serves the most recent week with findings, or an optionally named week
// (?week=YYYY-MM-DD). A null letter means nothing has been analyzed yet.
//
// A GET does NOT mutate (E-24 criterion 3, closing E-18's recorded limitation of
// a read that wrote). Marking the letter viewed is now the explicit
// POST /api/letter/viewed the screen fires after it has shown the letter.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const week = new URL(request.url).searchParams.get("week") ?? undefined;
  const letter = buildLetter(getDb(), week);
  return NextResponse.json({ letter });
}
