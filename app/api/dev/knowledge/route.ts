import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildKnowledgeInspection } from "@/lib/knowledge/inspector";

// [RETRO-002 T2] The dev-only knowledge inspector route. DEV BUILDS ONLY — a 404 in
// production, because this is a diagnostic (produced-lemma yield + the knowledge
// core's shape), never the operator's deferred user-facing "what Erika knows about
// you" surface. Read-only, no model calls.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
  }
  return NextResponse.json(buildKnowledgeInspection(getDb()));
}
