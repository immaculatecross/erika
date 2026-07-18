import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/sessions";
import { getJobBySession } from "@/lib/ingest/pipeline";
import { listSegments } from "@/lib/segments";
import { isWorkerAbsent } from "@/lib/jobs/liveness";
import { summarizeSpeech, type IngestView } from "@/lib/ingest-view";

// Read-only view of a session's ingest job for the detail page (E-3 part 2).
// GET only, additive — it reflects what the pipeline/worker produced (job
// state/stage/progress/error, the raw-vs-speech summary, and the speech
// segments the timeline draws). It never runs or mutates a job.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const session = getSession(db, id);
  const job = session ? getJobBySession(db, id) : null;
  if (!session || !job) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  const segments = listSegments(db, id);
  const view: IngestView = {
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    error: job.error,
    workerAbsent: isWorkerAbsent(db, "ingest_jobs", job.id),
    summary: summarizeSpeech(segments, session.durationSeconds),
    segments: segments.map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      durationMs: s.durationMs,
    })),
  };
  return NextResponse.json(view);
}
