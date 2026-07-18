import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getIncludedFinding } from "@/lib/findings-model";
import { getCompletedNote } from "@/lib/ask/notes";
import { askFinding, canAsk, estimateUsd, BudgetExceededError, NoCorpusToCiteError } from "@/lib/ask/engine";
import { openAiTextModel, TextModelUnavailableError, TextModelParseError } from "@/lib/lessons/text-model";
import type { AskNote } from "@/lib/ask/notes";

// The Ask Erika route (E-23, the v0.3 finale). GET is the read-only status the ask
// control primes with: whether a note already exists (and, if so, the note plus its
// resolved citations), or the estimated price of generating one and whether an ask
// is even possible (there must be ≥1 other finding to cite). POST generates the note
// once — refusing truthfully with 402 when the monthly cap is reached, exactly like
// analysis and render. Findings are read through the canonical model (E-17), never
// queried here directly.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ findingId: string }> };

/** Resolve cited finding ids to the linkable shape the UI jumps to. Orphan-safe. */
function resolveCites(db: ReturnType<typeof getDb>, note: AskNote) {
  return note.citedIds
    .map((id) => {
      const f = getIncludedFinding(db, id);
      return f ? { id: f.id, quote: f.quote, correction: f.correction } : null;
    })
    .filter((c): c is { id: string; quote: string; correction: string } => c !== null);
}

function noteBody(db: ReturnType<typeof getDb>, note: AskNote) {
  return { exists: true, note: note.note, cited: resolveCites(db, note) };
}

export async function GET(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const finding = getIncludedFinding(db, findingId);
  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  const note = getCompletedNote(db, findingId);
  if (note) return NextResponse.json(noteBody(db, note));

  return NextResponse.json({
    exists: false,
    canAsk: canAsk(db, finding),
    estimateUsd: estimateUsd(db, finding),
  });
}

export async function POST(_request: Request, { params }: Ctx) {
  const { findingId } = await params;
  const db = getDb();
  const finding = getIncludedFinding(db, findingId);
  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  try {
    const { note, generated } = await askFinding(db, openAiTextModel, finding);
    // A racing loser can win the claim check but return before the winner completes;
    // re-read so the response always carries the finished note.
    const finished = note ?? getCompletedNote(db, findingId);
    if (!finished) return NextResponse.json({ error: "The note is still being written." }, { status: 202 });
    // 201 only when THIS request generated the note; a cache hit / lost race is 200.
    return NextResponse.json(noteBody(db, finished), { status: generated ? 201 : 200 });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: "Monthly budget reached — no note can be generated until it is raised or the month rolls over." },
        { status: 402 },
      );
    }
    if (err instanceof NoCorpusToCiteError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof TextModelUnavailableError) {
      return NextResponse.json({ error: "Erika is unavailable right now." }, { status: 502 });
    }
    if (err instanceof TextModelParseError) {
      return NextResponse.json({ error: "Erika's note could not be read — try again." }, { status: 502 });
    }
    throw err;
  }
}
