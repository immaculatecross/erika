import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { realtimeModelForTier } from "@/lib/analysis/rates";
import { finalizeTutorLease, tutorLeaseModel } from "@/lib/tutor/money";

// Finalize a tutor session (E-34, WO criterion 5). On end the client reports the
// elapsed call time; this releases the session's pending reservations and commits
// EXACTLY ONE ledger row for the actual elapsed cost, clamped to what was reserved
// (the lease can't be overshot). The recording itself lands as a NORMAL session via
// the existing capture→ingest path (uploadAudio) — this route touches money only,
// never findings/evidence, so findings stay the one truth (E-17). Idempotent: an
// already-finalized session finalizes to nothing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const body = (await request.json().catch(() => ({}))) as { elapsedSeconds?: number };
  const elapsedSeconds = Number(body.elapsedSeconds);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return NextResponse.json({ error: { code: "bad_request", message: "elapsedSeconds must be a non-negative number." } }, { status: 400 });
  }

  // Read the model from the still-open lease before finalizing releases its rows.
  const model = tutorLeaseModel(db, id) ?? realtimeModelForTier(readSettings(db).realtimeTier);
  const committedUsd = finalizeTutorLease(db, id, model, elapsedSeconds / 60);
  return NextResponse.json({ committedUsd });
}
