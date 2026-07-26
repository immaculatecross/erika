import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { shadowTarget } from "@/lib/shadow";
import { renderPhrase, phraseRenderEstimateUsd } from "@/lib/render/phrase";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";
import { openAiTtsModel } from "@/lib/render/tts-model";
import { voiceFailureResponse } from "@/app/api/voice-errors";

// One shadow drill (E-33, D-18/D-21). GET is the read-only status the drill primes
// with: the correct target phrase, whether its render already exists, and the render
// estimate. POST renders the CORRECT target through the shared E-21 biller
// (reserve-before-call, cache, ledger) — refusing truthfully with 402 at the cap.
// The target is the finding's correction (lib/shadow.ts), never the error. No
// scoring: the shadow take is recorded through the normal capture→ingest path
// elsewhere; scoring is Azure/E-37 (D-21).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const drill = shadowTarget(db, findingId);
  if (!drill) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  const register = coerceRegister(readSettings(db).register);
  const exists = getPhraseRender(db, phraseHash(drill.target, register)) !== null;
  return NextResponse.json({
    findingId: drill.findingId,
    target: drill.target,
    explanation: drill.explanation,
    category: drill.category,
    register,
    exists,
    estimateUsd: phraseRenderEstimateUsd(drill.target),
  });
}

export async function POST(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const drill = shadowTarget(db, findingId);
  if (!drill) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  const register = coerceRegister(readSettings(db).register);
  try {
    const { generated } = await renderPhrase(db, openAiTtsModel, { text: drill.target, register });
    return NextResponse.json({ exists: true, generated }, { status: generated ? 201 : 200 });
  } catch (err) {
    return voiceFailureResponse(err);
  }
}
