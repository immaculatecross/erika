import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tutorRealtimeModel } from "@/lib/analysis/rates";
import { finalizeTutorLease, tutorLeaseModel } from "@/lib/tutor/money";
import { closeConversation, linkRecordingByCaptureTime } from "@/lib/tutor/conversations";

// Finalize a tutor session (E-34, extended at E-43). Two records close here, and they
// take OPPOSITE sides on the same number, on purpose:
//
//   * MONEY — the pending reservations collapse into EXACTLY ONE committed row for
//     the elapsed cost, clamped to what was reserved. The server-tracked elapsed time
//     FLOORS the client's ([T2c]), so nobody under-reports a long call to under-pay.
//   * THE CONVERSATION RECORD (v29) — the duration that decides whether the day is
//     credited is SERVER-measured and the client may only LOWER it (criterion 7). The
//     server's elapsed includes connecting and idling; the client knows how much was
//     really a conversation, and under-crediting yourself harms nobody.
//
// The recording itself lands as a NORMAL session through the existing capture→ingest
// path before this call, so findings stay the one truth (E-17); this route links it by
// capture time and touches no finding or evidence. Idempotent: an already-finalized
// session finalizes to nothing and a closed conversation is returned unchanged, so a
// retry — or the `pagehide` beacon racing the button — can never rewrite a recorded
// day or double-charge.
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
  const model = tutorLeaseModel(db, id) ?? tutorRealtimeModel();
  const committedUsd = finalizeTutorLease(db, id, model, elapsedSeconds / 60);

  const conversation = closeConversation(db, id, { clientSeconds: elapsedSeconds });
  const sessionId = conversation ? linkRecordingByCaptureTime(db, id) : null;

  return NextResponse.json({
    committedUsd,
    durationSeconds: conversation?.durationSeconds ?? null,
    metMinimum: conversation?.metMinimum ?? false,
    minSeconds: conversation?.minSeconds ?? null,
    sessionId,
  });
}
