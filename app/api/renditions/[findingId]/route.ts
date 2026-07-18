import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getIncludedFinding } from "@/lib/findings-model";
import { getRendition } from "@/lib/render/renditions";
import { renderCorrection, renditionEstimateUsd, BudgetExceededError } from "@/lib/render/engine";
import { openAiTtsModel } from "@/lib/render/tts-model";
import { TtsModelUnavailableError } from "@/lib/render/tts-model";

// The contrastive-playback rendition route (E-21). GET is the read-only status the
// Compare control primes with: whether a rendition already exists, the estimated
// price of generating one (from the rates table), and where the user's own clip
// sits on the session timeline. POST renders the correction once — refusing
// truthfully with 402 when the monthly cap is reached, exactly like analysis. The
// audio bytes are served by the sibling /audio route. Findings are read through the
// canonical model (E-17), never queried here directly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const finding = getIncludedFinding(db, findingId);
  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  const rendition = getRendition(db, findingId);
  return NextResponse.json({
    exists: rendition !== null,
    estimateUsd: renditionEstimateUsd(finding.correction),
    clip: { sessionId: finding.sessionId, startMs: finding.startMs, endMs: finding.endMs },
  });
}

export async function POST(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const finding = getIncludedFinding(db, findingId);
  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  try {
    const { generated } = await renderCorrection(db, openAiTtsModel, finding);
    return NextResponse.json({ exists: true, generated }, { status: generated ? 201 : 200 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: "Monthly budget reached — no rendition can be generated until it is raised or the month rolls over." },
        { status: 402 },
      );
    }
    if (err instanceof TtsModelUnavailableError) {
      return NextResponse.json({ error: "The voice model is unavailable right now." }, { status: 502 });
    }
    throw err;
  }
}
