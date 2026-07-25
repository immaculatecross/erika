import { NextResponse } from "next/server";
import { apiError } from "@/lib/api/error";
import { getDb } from "@/lib/db";
import { buildPlacementCheck } from "@/lib/placement/check";
import { placementStatus } from "@/lib/placement/status";
import { scorePlacement, recognizedItemIds, BANDS, type PlacementAnswer, type Band } from "@/lib/placement/scoring";
import { seedPlacement } from "@/lib/knowledge/seed-placement";

// The placement vocabulary check (E-35, D-19). GET builds a fresh check (real words
// per frequency band + pseudowords) and reports whether the learner has been placed
// or enrolled. POST scores the returned answers with a PURE, model-free function
// (yes-bias corrected via the pseudoword false-alarm rate) and seeds recognition-only
// evidence — words the learner knew + sub-level grammar — which can never mint `known`
// (D-19). No OpenAI key is touched anywhere on this path.
//
// [RETRO-004 §DE-2] Two things this response must carry that it did not. `caveat` says
// WHY an estimate is rough (response style / incoherent bands / thin sample) instead of
// leaving `calibrated: false` to be rendered as one undifferentiated line — and
// `calibrated` now reflects real confidence, not sample size alone. `runId` is the
// placement generation: a later run supersedes an earlier one, so a careless placement
// is repairable by re-taking the check rather than by deleting the database.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  const db = getDb();
  return NextResponse.json({
    status: placementStatus(db),
    check: buildPlacementCheck(),
  });
}

const isBand = (x: unknown): x is Band => typeof x === "string" && (BANDS as readonly string[]).includes(x);

/** Coerce one untrusted answer into a clean PlacementAnswer, or null to drop it. */
function sanitize(raw: unknown): PlacementAnswer | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const known = r.known === true;
  if (r.kind === "pseudo") return { kind: "pseudo", known };
  if (r.kind === "real") {
    const band = isBand(r.band) ? r.band : undefined;
    const itemId = typeof r.itemId === "string" ? r.itemId : undefined;
    return { kind: "real", band, itemId, known };
  }
  return null;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("bad_request", "Body must be JSON.", 400);
  }
  const rawAnswers = (body as { answers?: unknown })?.answers;
  if (!Array.isArray(rawAnswers) || rawAnswers.length === 0) {
    return apiError("no_answers", "Submit the check's answers to be scored.", 400);
  }

  const answers = rawAnswers.map(sanitize).filter((a): a is PlacementAnswer => a !== null);
  if (answers.length === 0) {
    return apiError("no_answers", "No readable answers were submitted.", 400);
  }

  const result = scorePlacement(answers);
  // Seeding records a placement RUN, which supersedes every earlier one (§DE-2): the
  // derivation stops counting the previous placement's seeds, so re-taking the check
  // actually re-places the learner. `evidence` is still only ever appended to.
  const seeded = seedPlacement(getDb(), {
    level: result.level,
    recognizedItemIds: recognizedItemIds(answers),
    calibrated: result.calibrated,
    falseAlarmRate: result.falseAlarmRate,
  });

  return NextResponse.json({
    level: result.level,
    calibrated: result.calibrated,
    // Why the estimate is rough, so the UI can say so rather than imply confidence.
    caveat: result.caveat,
    highestCleared: result.highestCleared,
    contiguous: result.contiguous,
    falseAlarmRate: result.falseAlarmRate,
    bands: result.bands,
    runId: seeded.runId,
    seededWords: seeded.seededWords,
    seededRules: seeded.seededRules,
    supersededItems: seeded.supersededItems,
  });
}
