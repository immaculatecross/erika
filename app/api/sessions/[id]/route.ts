import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { removeRenditionFile, removeSessionDir } from "@/lib/audio-storage";
import { renditionPathsForSession } from "@/lib/render/renditions";
import { deleteSession, getSession } from "@/lib/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(getDb(), id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json(session);
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  // Rows first (ingest_jobs, segments, and E-4 findings + analysis_jobs all
  // cascade on the session FK), then the on-disk directory — which also holds the
  // E-3 normalized rendition and extracted segments. Hash-keyed shared state is
  // intentionally retained: cached renditions in data/cache/, the segment_analyses
  // never-re-bill witnesses, and the spend_ledger (deleting a session must never
  // erase spend history or let a re-run evade the budget cap).
  // Read the E-21 rendition file paths BEFORE the delete: their rows cascade away
  // with the findings, so the on-disk files must be gathered first, then unlinked
  // after (best-effort; a missing file is a no-op, and playback is orphan-safe).
  const db = getDb();
  const renditionFiles = renditionPathsForSession(db, id);
  const existed = deleteSession(db, id);
  if (!existed) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  await removeSessionDir(id);
  await Promise.all(renditionFiles.map((p) => removeRenditionFile(p)));
  return NextResponse.json({ ok: true });
}
