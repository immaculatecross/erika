import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";
import { hasAnalysisKey } from "@/lib/env-file";
import { recordVisit, resolveDrill } from "@/lib/pronunciation";

// One completed studio loop (E-37): the learner heard the correct line, recorded a take,
// and played it back. This is the SHIPPED DEFAULT's record of practice — no scorer, no
// score, no money, no upload. It exists so that "this correction has been worked" is
// answerable on a server with no Azure key, which is what lets the composer retire a
// pronunciation finding (it no longer gets a card, so a card can never retire it).
//
// Deliberately NOT evidence: a visit records an activity, never a claim about how well
// it went. Nothing here touches `evidence` or a knowledge item — D-19 is emphatic that
// green means mastery, never activity, and a lap in the studio is activity.
//
// ---- THE SERVER-SIDE BACKSTOP [E-39 §B4 / RETRO-004 Tier 4 §24] ----------------------
//
// A visit is PERMANENT: it retires the correction from the daily plan for good. The
// "heard the correct line" half of that claim used to be enforced ONLY by the client
// (`drillGate`), and this route accepted a bare POST from anything — a stale tab, a
// script, a replayed request. This invariant has already broken twice, so it is now also
// checked where it cannot be bypassed.
//
// WHAT THE SERVER CAN HONESTLY ATTEST. It cannot know that audio reached the learner's
// ears; only the client can. It CAN know whether hearing the line was POSSIBLE, and that
// is the premise the permanent write rests on. Exactly two states qualify:
//
//   * THE RENDITION EXISTS — a cached phrase render for this reference text at this
//     register. The line is playable here, so the client's gate had something real to
//     gate on and its verdict is credible.
//   * THE SERVER HAS NO VOICE AT ALL — nothing is configured, so no rendition can ever
//     exist, "listen first" is unsatisfiable, and the reduced loop (read the guidance, say
//     it, hear yourself back) IS the drill. Refusing here is what looped a pronunciation
//     finding through the daily plan every day forever with no action able to clear it.
//
// The state that does NOT qualify is the middle one, and it is the whole point: a server
// that CAN render, on a drill nothing has ever rendered. Nothing was played, so nothing
// was heard, so a POST claiming the loop is a claim the server can see is false. It is
// refused with 409 and the drill stays on the plan, exactly as before the request.
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

  const register = coerceRegister(readSettings(db).register);
  const renditionExists = getPhraseRender(db, phraseHash(drill.referenceText, register)) !== null;
  const voiceAvailable = hasAnalysisKey();
  if (!renditionExists && voiceAvailable) {
    return apiError(
      "line_not_heard",
      "This drill's line has not been played on this server yet, so the loop is not complete. Play the line, then record and listen back.",
      409,
    );
  }

  const visit = recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
  return NextResponse.json({ drillKey: visit.drillKey, cycles: visit.cycles, lastAt: visit.lastAt });
}
