import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { getSession, setSessionExcluded } from "@/lib/sessions";

// The manual "this recording isn't me" surface (E-36, D-22 — a RETRO-002 owed item).
// POST { excluded: boolean } sets/clears sessions.exclude_from_evidence; an excluded
// session mints NO produced-lemma positive evidence on its next analysis run,
// regardless of the on-device acoustic verdict. Nothing here deletes audio or
// findings — it governs future production credit only (the evidence log is
// append-only). Returns the updated session.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("bad_json", "Request body must be JSON.", 400);
  }
  const excluded = (body as { excluded?: unknown })?.excluded;
  if (typeof excluded !== "boolean") {
    return apiError("bad_request", "Body must be { excluded: boolean }.", 400);
  }
  const db = getDb();
  if (!setSessionExcluded(db, id, excluded)) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  return NextResponse.json(getSession(db, id));
}
