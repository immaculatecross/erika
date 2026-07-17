import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/sessions";
import { readSettings } from "@/lib/settings";
import { enqueueAnalysis, getAnalysisJobBySession } from "@/lib/analysis/cascade";
import { listFindings } from "@/lib/analysis/findings";
import { monthToDateSpend } from "@/lib/analysis/budget";
import { categoryCounts, type AnalysisView } from "@/lib/analysis-view";

// Start an async analysis run for a session (E-4, D-10). POST enqueues a job the
// worker drains — it never blocks the request on the cascade. The budget is
// re-checked here server-side (never trusting a client estimate): if the month's
// spend has already reached the cap, the run is refused truthfully. GET is the
// read-only report surface (E-4b): the run's state for live polling plus the
// findings and per-category counts the report renders. GET only — no mutation.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  if (!getSession(db, id)) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const job = getAnalysisJobBySession(db, id);
  const findings = listFindings(db, id);
  const view: AnalysisView = {
    state: job?.state ?? "idle",
    stage: job?.stage ?? null,
    progress: job?.progress ?? 0,
    error: job?.error ?? null,
    findings: findings.map((f) => ({
      id: f.id,
      quote: f.quote,
      correction: f.correction,
      category: f.category,
      explanation: f.explanation,
      severity: f.severity,
      startMs: f.startMs,
      endMs: f.endMs,
    })),
    counts: categoryCounts(findings),
    total: findings.length,
  };
  return NextResponse.json(view);
}

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  if (!getSession(db, id)) return NextResponse.json({ error: "Session not found." }, { status: 404 });

  const { monthlyBudgetUsd } = readSettings(db);
  const spent = monthToDateSpend(db);
  if (spent >= monthlyBudgetUsd - 1e-9) {
    return NextResponse.json(
      { error: "Monthly budget reached — no analysis can run until it is raised or the month rolls over." },
      { status: 402 },
    );
  }

  const job = enqueueAnalysis(db, id);
  return NextResponse.json({ job }, { status: 202 });
}
