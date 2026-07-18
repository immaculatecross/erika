import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildLetter } from "@/lib/letter";
import { markLetterViewed } from "@/lib/plan";

// The editor's letter read route (E-12). Pure weekly aggregation over existing
// findings, segments and analysis jobs — the coaching layer, no model calls.
// Serves the most recent week with findings, or an optionally named week
// (?week=YYYY-MM-DD). A null letter means nothing has been analyzed yet.
//
// Serving a letter records it as opened (E-18 criterion 1) — the one write, into
// the existing settings kv, so the Practice plan can stop calling it unread. The
// marker is forward-only: re-reading an archived week changes nothing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const week = new URL(request.url).searchParams.get("week") ?? undefined;
  const db = getDb();
  const letter = buildLetter(db, week);
  if (letter) markLetterViewed(db, letter.weekStart);
  return NextResponse.json({ letter });
}
