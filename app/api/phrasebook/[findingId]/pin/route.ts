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
// exact artifact the studio exists to replace. No card is minted, and the answer is a
// plain 200 — being refused a broken card is not an error.
//
// The response NAMES the studio drill (`routedTo`/`studioPath`) but no client consumes
// it: the Phrasebook offers a "Practise in Studio" link directly instead, so it never
// posts a pin for a pronunciation row and this branch is not reachable from the UI. It is
// kept for API honesty — a direct caller gets a truthful answer and somewhere to go —
// and `studioPath` is present only when a drill actually resolves there.
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
    // [E-45] A refusal must say something TRUE. Since E-45 a finding can also be
    // uncardable because its correction has no localized change to cue from — a
    // whole-sentence rewrite, a single-word fix, a register slip — and telling that
    // learner "this one is about how it sounds" would simply be false. The class is
    // decided once, in `uncardableReason` (lib/cards.ts), which is also where the
    // Amendment 1 tie-break lives: a blurred final vowel labelled `grammar` resolves
    // to the pronunciation class and is sent to the studio exactly like one labelled
    // `pronunciation`, so one finding no longer gets two different answers.
    if (outcome.reason === "no_answerable_front") {
      return NextResponse.json({
        inDeck: false,
        routedTo: null,
        message:
          "This one is a whole rewrite rather than a single fix, so there is no card that could be asked fairly — it stays in your phrasebook.",
      });
    }
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
