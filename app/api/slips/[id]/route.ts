import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSlipDossier, materializeSlips } from "@/lib/slips";

// One slip's dossier route (E-20): every occurrence interleaved with its drill
// history on one chronological timeline. Materializes first so a slip linked from
// a freshly-built index is present. Unknown/empty slip → 404. No model calls.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  materializeSlips(db);
  const dossier = getSlipDossier(db, id);
  if (!dossier) return NextResponse.json({ error: "Slip not found." }, { status: 404 });
  return NextResponse.json(dossier);
}
