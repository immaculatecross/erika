import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings, writeSettings, SettingsValidationError } from "@/lib/settings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { hasAnalysisKey, REQUIRED_KEY } from "@/lib/env-file";

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
    // [E-39 §B5] Whether an API key is configured — a BOOLEAN, never the key. Settings
    // never mentioned that Erika needs one; the only place a new user learned it was a
    // leaked internal error string on the tutor screen. Reported here so Settings can say
    // it once, plainly, where a person goes looking.
    analysisKeyPresent: hasAnalysisKey(),
    requiredKeyName: REQUIRED_KEY,
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
