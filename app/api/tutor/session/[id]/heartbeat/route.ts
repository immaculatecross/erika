import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { realtimeModelForTier } from "@/lib/analysis/rates";
import {
  ensureTutorLeaseCovers,
  maxTutorSessionSeconds,
  tutorLeaseModel,
  tutorLeaseOpenedAtMs,
} from "@/lib/tutor/money";

// The tutor lease heartbeat (E-34, WO criterion 5). While a call is open the client
// heartbeats with its elapsed time; this extends the lease so the reserved amount
// always stays AHEAD of the call. If the cap cannot cover the next block the call is
// refused an extension (402) and the client winds it down — a long call can never
// silently overshoot the budget. The model is read from the lease server-side, never
// trusted from the client.
//
// [T2b] This route is ALSO where the server-side DURATION ceiling is enforced. There
// are therefore two independent refusals, both returning the SAME shape the client
// already winds down on (`covered: false`, 402), told apart by `error.code`:
//
//   * `budget`         — the cap cannot cover the next block of this call.
//   * `duration_limit` — the call has outrun `maxTutorSessionSeconds()`.
//
// The duration check reads the SERVER's own clock (the lease's open `reserved_at`, the
// same source [T2c] finalize floors on), never the client-reported `elapsedSeconds`, so
// a client cannot under-report its way past the ceiling. Neither refusal touches the
// lease: the pending rows stay put, so `/end` finalizes the elapsed spend as usual and
// an abandoned call is still COMMITTED by the stale-reservation sweep ([T2a]). A
// refusal never releases or loses recorded spend.
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

  // The server's own elapsed time for this call: now − when the lease was opened. Read
  // BEFORE the extension below, so a fresh reservation cannot reset it. Null (no open
  // lease) means there is no server-tracked call to bound.
  const openedAt = tutorLeaseOpenedAtMs(db, id);
  const serverElapsedSeconds = openedAt === null ? 0 : Math.max(0, (Date.now() - openedAt) / 1000);

  // The lease must cover the elapsed call plus a one-minute buffer, so it stays ahead.
  // This runs even when the call is over the duration ceiling: the spend already
  // incurred must be reserved so `/end` can commit it in full (finalize clamps the
  // committed row to what was reserved).
  const minutesNeeded = Math.ceil(elapsedSeconds / 60) + 1;
  const model = tutorLeaseModel(db, id) ?? realtimeModelForTier(readSettings(db).realtimeTier);
  const covered = ensureTutorLeaseCovers(db, id, model, minutesNeeded, readSettings(db).monthlyBudgetUsd);
  if (!covered) {
    return NextResponse.json(
      { covered: false, error: { code: "budget", message: "The monthly budget cannot cover more of this call. Please wrap up." } },
      { status: 402 },
    );
  }

  // [T2b] The hard ceiling on a single session's LENGTH — a bound the client cannot
  // lengthen, independent of the cap. Same refusal shape as the budget refusal, so the
  // existing client wind-down ends the call with no client change.
  const maxSeconds = maxTutorSessionSeconds();
  if (serverElapsedSeconds > maxSeconds) {
    return NextResponse.json(
      {
        covered: false,
        maxSessionSeconds: maxSeconds,
        error: {
          code: "duration_limit",
          message: `This tutor session reached its ${Math.round(maxSeconds / 60)}-minute limit. Please wrap up.`,
        },
      },
      { status: 402 },
    );
  }
  return NextResponse.json({ covered: true });
}
