import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings, writeSettings, SettingsValidationError } from "@/lib/settings";

// API-first (D-2): a later mobile client reuses these handlers. The DB stays
// server-side — it is never touched from a React render path.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(readSettings(getDb()));
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
