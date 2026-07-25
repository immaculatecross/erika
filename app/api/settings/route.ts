import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings, writeSettings, SettingsValidationError } from "@/lib/settings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { hasAnalysisKey } from "@/lib/env-file";

// API-first (D-2): a later mobile client reuses these handlers. The DB stays
// server-side — it is never touched from a React render path. GET also reports
// the month's real spend from `spend_ledger` (E-18 criterion 4) — display only;
// the cap itself and every budget check are untouched.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  return NextResponse.json({
    ...readSettings(db),
    spentThisMonth: monthToDateSpend(db),
    // WHETHER a key is configured — never the key itself, and never any part of it
    // (E-42 criterion 7). Settings is the one place that explains Erika needs one, so
    // it is also the one place that can say whether it currently has one; before this
    // the only way a new user learned a key was required was a leaked internal error
    // string on the tutor screen.
    analysisKeyPresent: hasAnalysisKey(),
  });
}

export async function PUT(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Request body must be an object." }, { status: 400 });
  }
  try {
    const updated = writeSettings(getDb(), body as Record<string, unknown>);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
