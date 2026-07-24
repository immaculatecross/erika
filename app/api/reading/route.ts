import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { coerceRegister } from "@/lib/register";
import { buildReadingView } from "@/lib/reading";
import { phraseRenderEstimateUsd } from "@/lib/render/phrase";
import { getPhraseRender, phraseHash } from "@/lib/render/phrase-renders";

// The reading/listening surface (E-33, WO criterion 3). Returns the canon passage
// matched to the learner's edge (by CEFR band of their knowledge state) plus, for
// the optional listen, whether its TTS render already exists and the render
// estimate. ZERO model calls; passage selection is a pure function (lib/reading.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  const { edge, passage } = buildReadingView(db);
  if (!passage) return NextResponse.json({ edge, passage: null });

  const register = coerceRegister(readSettings(db).register);
  const exists = getPhraseRender(db, phraseHash(passage.text, register)) !== null;
  return NextResponse.json({
    edge,
    passage,
    listen: { exists, estimateUsd: phraseRenderEstimateUsd(passage.text) },
  });
}
