import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/sessions";
import { getJobBySession, requeueFailedJob } from "@/lib/ingest/pipeline";
import { listSegments } from "@/lib/segments";
import { isWorkerAbsent } from "@/lib/jobs/liveness";
import { summarizeSpeech, type IngestView } from "@/lib/ingest-view";

// A session's ingest job for the detail page (E-3 part 2).
//
// GET is the read-only view — it reflects what the pipeline/worker produced (job
// state/stage/progress/error, the raw-vs-speech summary, and the speech segments the
// timeline draws). It never runs or mutates a job.
//
// POST requeues a FAILED job, and exists because the v0.7 failure-path gate found a
// failed ingest with no way out of it in the entire app: this file was GET-only, so
// nothing could re-drive a stuck session and the only escape was to delete it and
// upload the file again. It is a WRITE, so it is a POST (the E-18/E-24 read/write
// split) — and it spends nothing: it moves a row back to `queued` and the worker picks
// it up on its own tick, from the audio already on disk.
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

export async function POST(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const db = getDb();
  const session = getSession(db, id);
  const job = session ? getJobBySession(db, id) : null;
  if (!session || !job) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }
  // Only a failed job can be requeued, and saying so is the truthful answer to a
  // second tap: nothing is silently re-driven, and nothing in flight is disturbed.
  if (!requeueFailedJob(db, id)) {
    return NextResponse.json({ requeued: false, state: job.state }, { status: 409 });
  }
  return NextResponse.json({ requeued: true, state: "queued" });
}
