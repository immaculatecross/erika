import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { removeSessionDir } from "@/lib/audio-storage";
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
  // Rows first (ingest_jobs cascade), then the on-disk directory.
  const existed = deleteSession(getDb(), id);
  if (!existed) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  await removeSessionDir(id);
  return NextResponse.json({ ok: true });
}
