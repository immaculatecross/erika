import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseLogEvidenceArgs, logTutorEvidence, InvalidEvidenceCallError } from "@/lib/tutor/log-evidence";

// The `log_evidence` tool bridge route (E-34, WO criterion 3). During a call the
// Realtime model calls `log_evidence`; the browser forwards each call here, and this
// writes ONE row to the append-only evidence log through the E-25 door on a VALIDATED
// id (morph-it-attested lemma / seeded rule). An invalid id is rejected (400), never
// minted. This is the one write path for tutor evidence — no second findings channel.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "bad_request", message: "Request body must be JSON." } }, { status: 400 });
  }
  try {
    const call = parseLogEvidenceArgs(raw);
    const evidence = logTutorEvidence(getDb(), call);
    return NextResponse.json({ evidence }, { status: 201 });
  } catch (err) {
    if (err instanceof InvalidEvidenceCallError) {
      return NextResponse.json({ error: { code: "invalid_evidence", message: err.message } }, { status: 400 });
    }
    throw err;
  }
}
