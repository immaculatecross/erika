import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { buildProgress } from "@/lib/progress";

// "What Erika knows about you" (E-46 criterion 6). Read-only: this route derives,
// it never writes and it never mints. It replaces `GET /api/dev/knowledge`, which
// was 404'd in production and showed raw table counts to nobody.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(buildProgress(getDb()));
}
