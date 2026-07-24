import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { realtimeModelForTier } from "@/lib/analysis/rates";
import { ensureTutorLeaseCovers, tutorLeaseModel } from "@/lib/tutor/money";

// The tutor lease heartbeat (E-34, WO criterion 5). While a call is open the client
// heartbeats with its elapsed time; this extends the lease so the reserved amount
// always stays AHEAD of the call. If the cap cannot cover the next block the call is
// refused an extension (402) and the client winds it down — a long call can never
// silently overshoot the budget. The model is read from the lease server-side, never
// trusted from the client.
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

  // The lease must cover the elapsed call plus a one-minute buffer, so it stays ahead.
  const minutesNeeded = Math.ceil(elapsedSeconds / 60) + 1;
  const model = tutorLeaseModel(db, id) ?? realtimeModelForTier(readSettings(db).realtimeTier);
  const covered = ensureTutorLeaseCovers(db, id, model, minutesNeeded, readSettings(db).monthlyBudgetUsd);
  if (!covered) {
    return NextResponse.json(
      { covered: false, error: { code: "budget", message: "The monthly budget cannot cover more of this call. Please wrap up." } },
      { status: 402 },
    );
  }
  return NextResponse.json({ covered: true });
}
