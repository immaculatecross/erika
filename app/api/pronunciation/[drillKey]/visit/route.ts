import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { recordVisit, resolveDrill } from "@/lib/pronunciation";

// One completed studio loop (E-37): the learner heard the correct line, recorded a take,
// and played it back. This is the SHIPPED DEFAULT's record of practice — no scorer, no
// score, no money, no upload. It exists so that "this correction has been worked" is
// answerable on a server with no Azure key, which is what lets the composer retire a
// pronunciation finding (it no longer gets a card, so a card can never retire it).
//
// The "heard the correct line" half is enforced by the CLIENT (`drillGate`): a lap taken
// when the rendition could not be played does not reach this route at all. That matters
// because a visit is permanent — it retires the correction from the daily plan — and
// recording without ever hearing the target is not the drill this record claims it is.
//
// Deliberately NOT evidence: a visit records an activity, never a claim about how well
// it went. Nothing here touches `evidence` or a knowledge item — D-19 is emphatic that
// green means mastery, never activity, and a lap in the studio is activity.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ drillKey: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { drillKey } = await params;
  const db = getDb();
  // Resolved through the same producer door as everything else, so an arbitrary key can
  // never mint a visit row for something that is not a drill.
  const drill = resolveDrill(db, drillKey);
  if (!drill) return apiError("drill_not_found", "That drill is no longer available.", 404);

  const visit = recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
  return NextResponse.json({ drillKey: visit.drillKey, cycles: visit.cycles, lastAt: visit.lastAt });
}
