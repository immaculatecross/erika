import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { tutorRealtimeModel } from "@/lib/analysis/rates";
import {
  finalizeTutorLease,
  tutorConversationCommittedUsd,
  tutorLeaseModel,
} from "@/lib/tutor/money";
import { closeConversation, linkRecordingByCaptureTime } from "@/lib/tutor/conversations";

// Finalize a tutor session (E-34, extended at E-43). Two records close here, and they
// take OPPOSITE sides on the same number, on purpose:
//
//   * MONEY — the pending reservations collapse into EXACTLY ONE committed row,
//     clamped to what was reserved. [T2c] floors duration at server-tracked elapsed
//     and never commits Realtime below that minute-floor estimate solely because the
//     client sent a finite usage figure (including 0); higher client usage still wins.
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
  const body = (await request.json().catch(() => ({}))) as {
    elapsedSeconds?: number;
    realtimeUsageCostUsd?: number;
  };
  const elapsedSeconds = Number(body.elapsedSeconds);
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return NextResponse.json({ error: { code: "bad_request", message: "elapsedSeconds must be a non-negative number." } }, { status: 400 });
  }

  // Read the model from the still-open lease before finalizing releases its rows.
  const model = tutorLeaseModel(db, id) ?? tutorRealtimeModel();
  finalizeTutorLease(
    db,
    id,
    model,
    elapsedSeconds / 60,
    new Date(),
    Number.isFinite(body.realtimeUsageCostUsd) ? body.realtimeUsageCostUsd : undefined,
  );

  const conversation = closeConversation(db, id, { clientSeconds: elapsedSeconds });
  const sessionId = conversation ? linkRecordingByCaptureTime(db, id) : null;

  return NextResponse.json({
    committedUsd: tutorConversationCommittedUsd(db, id),
    durationSeconds: conversation?.durationSeconds ?? null,
    metMinimum: conversation?.metMinimum ?? false,
    minSeconds: conversation?.minSeconds ?? null,
    sessionId,
  });
}
