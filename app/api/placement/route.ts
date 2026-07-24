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
  const seeded = seedPlacement(getDb(), {
    level: result.level,
    recognizedItemIds: recognizedItemIds(answers),
  });

  return NextResponse.json({
    level: result.level,
    calibrated: result.calibrated,
    falseAlarmRate: result.falseAlarmRate,
    bands: result.bands,
    seededWords: seeded.seededWords,
    seededRules: seeded.seededRules,
  });
}
