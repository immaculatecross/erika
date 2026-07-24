import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/sessions";
import { readSettings } from "@/lib/settings";
import { triageTempo } from "@/lib/ingest/render";
import { listSegments } from "@/lib/segments";
import { pendingSegments, isFullDeepSession } from "@/lib/analysis/cascade";
import { estimateCost } from "@/lib/analysis/cost";
import { monthToDateSpend } from "@/lib/analysis/budget";

// Pre-run cost estimate for a session's analysis (E-4, D-10). Pure read: it
// prices only the not-yet-cached segments over the rates table and reports it
// alongside month-to-date spend and the budget cap, so the report UI (E-4b) can
// show the cost before a run and whether it fits. Never starts a run.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const session = getSession(db, id);
  if (!session) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const settings = readSettings(db);
  const pending = pendingSegments(db, id);
  // The short-capture full-deep decision is made from the session's TOTAL speech
  // (all segments, not just the pending ones), exactly as the run makes it — so the
  // estimate the user sees reflects the path the run will take: 100% deep, no triage
  // for a short capture; the loosened cascade for a day dump (E-28, D-20 criterion 4).
  const fullDeep = isFullDeepSession(listSegments(db, id));
  const estimate = estimateCost(
    pending.map((s) => ({ durationMs: s.durationMs })),
    { tempo: triageTempo(), fullDeep },
  );
  const spentThisMonth = monthToDateSpend(db);

  return NextResponse.json({
    estimate,
    fullDeep,
    spentThisMonth,
    budgetUsd: settings.monthlyBudgetUsd,
    remainingUsd: Math.max(settings.monthlyBudgetUsd - spentThisMonth, 0),
  });
}
