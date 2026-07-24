import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { pinFinding } from "@/lib/cards";
import { resolveDrill } from "@/lib/pronunciation";
import { drillKeyForFinding, studioDrillPath } from "@/lib/pronunciation/types";

// Pin a phrasebook entry into the flashcard deck (E-9). Ensures a card exists for
// the finding and clears any prior delete-tombstone (pinFinding) — so an entry the
// user removed from their deck can be deliberately added back. Idempotent (pinning
// twice leaves exactly one card, schedule untouched). Unknown finding → 404. Never
// touches the SM-2 scheduler, bulk generate, or the grade/due flow.
//
// [E-37] A PRONUNCIATION finding is ROUTED, not carded. Its spelling was never wrong,
// so a card front degrades to an unanswerable "____ · pronunciation" (RETRO-003) — the
// exact artifact the studio exists to replace. The learner asked to practise this line,
// which is a good request, so they get the surface that can actually drill it: the
// response names the studio drill and the client follows it. No card is minted, and the
// answer is a plain 200 — being sent somewhere better is not an error.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const outcome = pinFinding(getDb(), findingId);

  if (outcome.status === "not_found") {
    return NextResponse.json({ error: "Finding not found." }, { status: 404 });
  }
  if (outcome.status === "not_cardable") {
    // Only promise the studio when a drill actually resolves there. A correction too
    // long for the short-audio path has no drill, and handing back a path that renders
    // "That drill is no longer available" would be a worse answer than a plain one.
    const drill = resolveDrill(getDb(), drillKeyForFinding(findingId));
    if (!drill) {
      return NextResponse.json({
        inDeck: false,
        routedTo: null,
        message: "This one is about how it sounds, and it is too long to drill — it stays in your phrasebook.",
      });
    }
    return NextResponse.json({
      inDeck: false,
      routedTo: "studio",
      studioPath: studioDrillPath(drill.drillKey),
      message: "This one is about how it sounds — practise it in the studio.",
    });
  }
  return NextResponse.json({ inDeck: true, cardId: outcome.card.id });
}
