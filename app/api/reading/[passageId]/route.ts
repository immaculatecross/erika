import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { getPassage } from "@/lib/canon";
import { renderPhrase } from "@/lib/render/phrase";
import { BudgetExceededError } from "@/lib/render/engine";
import { openAiTtsModel, TtsModelUnavailableError } from "@/lib/render/tts-model";

// Render a canon passage's optional LISTEN (E-33). POST renders the passage text
// through the shared E-21 biller (reserve-before-call, per-phrase cache, ledger) —
// refusing truthfully with 402 at the cap. The audio bytes are served by the sibling
// /audio route. Public-domain text only (D-19); the render is cached, so a replay
// bills zero.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ passageId: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  const { passageId } = await params;
  const db = getDb();
  const passage = getPassage(passageId);
  if (!passage) return NextResponse.json({ error: "Passage not found." }, { status: 404 });

  const register = coerceRegister(readSettings(db).register);
  try {
    const { generated } = await renderPhrase(db, openAiTtsModel, { text: passage.text, register });
    return NextResponse.json({ exists: true, generated }, { status: generated ? 201 : 200 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: "Monthly budget reached — no render can be generated until it is raised or the month rolls over." },
        { status: 402 },
      );
    }
    if (err instanceof TtsModelUnavailableError) {
      return NextResponse.json({ error: "The voice model is unavailable right now." }, { status: 502 });
    }
    throw err;
  }
}
