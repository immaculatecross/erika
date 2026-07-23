import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { collectLetterSessions, latestWeekWithFindings } from "@/lib/letter";
import { getViewedLetterWeek, markLetterViewed } from "@/lib/plan";

// Recording that the letter was read is now an explicit write (E-24 criterion 3),
// split out of the GET so reading the letter mutates nothing. The screen fires
// this after it has shown the letter, so the Practice plan's `letterUnread`
// flips exactly as before.
//
// Body: { "week": "YYYY-MM-DD" }, optional — defaults to the latest week that
// has findings (the week the screen just rendered). The marker is forward-only
// (markLetterViewed), so re-posting an older or equal week never regresses it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { week?: unknown };

  let week: string | undefined;
  if (body.week !== undefined) {
    if (typeof body.week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.week)) {
      return apiError("invalid_week", "week must be an ISO date, YYYY-MM-DD.", 400);
    }
    week = body.week;
  } else {
    week = latestWeekWithFindings(collectLetterSessions(db)) ?? undefined;
  }

  // Nothing analyzed yet — there is no letter to mark, and that is not an error.
  if (!week) return NextResponse.json({ viewedWeek: null });

  // Forward-only: marking an older/equal week is a no-op, so the response
  // reports the marker's true state after the write, not the requested week.
  markLetterViewed(db, week);
  return NextResponse.json({ viewedWeek: getViewedLetterWeek(db) });
}
