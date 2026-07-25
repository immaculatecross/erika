import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { processJob } from "@/lib/ingest/pipeline";
import { listSegments, upsertSegment } from "@/lib/segments";
import { getAnalysisJobBySession, enqueueAnalysis } from "@/lib/analysis/cascade";
import { enqueueAfterIngest, resumeHaltedAnalysis, sweepPendingAnalysis } from "@/lib/analysis/auto";
import { recordSpend, monthToDateSpend } from "@/lib/analysis/budget";
import { writeSettings } from "@/lib/settings";
import { analysisUnavailableMessage, isMissingKeyMessage, REQUIRED_KEY } from "@/lib/analysis-key";
import { anyInFlight } from "@/lib/use-sessions";
import { isInFlight, sessionPhase, type SessionListItem } from "@/lib/sessions-list-view";
import { listSessionItems } from "@/lib/session-yield";
import { cleanup, workspace, type Part, type Workspace } from "./fixtures";

// ANALYSIS STARTS ITSELF (E-42 criteria 3, 8, 9).
//
// The defect this replaces: `POST /api/sessions/[id]/analysis` was browser-driven, so
// the learner had to notice ingest had finished (the home never polled), press
// Analyze, read an estimate and press Start — and closing the laptop between any two
// of those stranded the recording forever. The commonest real behaviour was the one
// that guaranteed no findings.
//
// So the central test here runs a REAL ingest to completion with no client in the
// room at all — no route, no fetch, no React — and asserts an analysis job exists
// afterwards. Everything runs against a disposable database under an OS temp dir.

const TAKE: Part[] = [
  { kind: "tone", seconds: 2 },
  { kind: "silence", seconds: 2 },
  { kind: "tone", seconds: 2 },
];

let ws: Workspace;
afterEach(() => {
  if (ws) cleanup(ws);
});

describe("ingest completing IS what starts the analysis (criterion 3)", () => {
  it("a real ingest run, with no client present, leaves a queued analysis job", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    expect(getAnalysisJobBySession(ws.db, sessionId)).toBeNull();

    // The whole pipeline, driven directly — this is the worker's code path, and there
    // is no browser anywhere in it.
    const job = await processJob(ws.db, jobId);
    expect(job.state).toBe("done");
    expect(listSegments(ws.db, sessionId).length).toBeGreaterThan(0);

    const analysis = getAnalysisJobBySession(ws.db, sessionId)!;
    expect(analysis).not.toBeNull();
    expect(analysis.state).toBe("queued");

    // And it survives a reopen — the enqueue is committed, not in-memory state a
    // closed tab could take with it.
    const reread = openDatabase(path.join(ws.dir, "erika.db"));
    expect(getAnalysisJobBySession(reread, sessionId)!.state).toBe("queued");
    reread.close();
  }, 120_000);

  it("does NOT queue a run for a session with no speech — a $0 run reads as a clean bill of health", async () => {
    ws = workspace();
    // Pure silence: VAD keeps nothing, so there is nothing for a model to hear.
    const { sessionId, jobId } = ws.seed([{ kind: "silence", seconds: 4 }]);
    const job = await processJob(ws.db, jobId);
    expect(job.state).toBe("done");
    expect(listSegments(ws.db, sessionId)).toHaveLength(0);
    expect(getAnalysisJobBySession(ws.db, sessionId)).toBeNull();
  }, 120_000);

  it("is idempotent — a resumed or re-run ingest never mints a second run", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    await processJob(ws.db, jobId);
    const first = getAnalysisJobBySession(ws.db, sessionId)!.id;

    // Re-entering the pipeline (the resume path) must not duplicate the job — a
    // duplicate would be a second billed run over the same audio.
    ws.db.prepare("UPDATE ingest_jobs SET state='processing', stage='rendering' WHERE id=?").run(jobId);
    await processJob(ws.db, jobId);
    expect(enqueueAfterIngest(ws.db, sessionId)).toBeNull();
    const rows = ws.db
      .prepare("SELECT id FROM analysis_jobs WHERE session_id = ?")
      .all(sessionId) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([first]);
  }, 120_000);
});

describe("the sweep is the invariant behind the instance", () => {
  it("queues a run for an ingested session with speech that somehow has none", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    await processJob(ws.db, jobId);
    // Simulate the states the per-completion enqueue cannot cover: a row from before
    // this milestone, or a crash between the two writes.
    ws.db.prepare("DELETE FROM analysis_jobs WHERE session_id = ?").run(sessionId);
    expect(getAnalysisJobBySession(ws.db, sessionId)).toBeNull();

    expect(sweepPendingAnalysis(ws.db)).toEqual([sessionId]);
    expect(getAnalysisJobBySession(ws.db, sessionId)!.state).toBe("queued");
    // Idempotent: running it again queues nothing.
    expect(sweepPendingAnalysis(ws.db)).toEqual([]);
  }, 120_000);

  it("never resurrects a run that already exists in ANY state, so a refusal cannot loop", async () => {
    ws = workspace();
    const { sessionId, jobId } = ws.seed(TAKE);
    await processJob(ws.db, jobId);
    const id = getAnalysisJobBySession(ws.db, sessionId)!.id;
    // The keyless case: the worker fails this job terminally, per job. If the sweep
    // re-queued it, the worker would refuse it again every tick, forever.
    for (const state of ["failed", "done", "halted", "processing"]) {
      ws.db.prepare("UPDATE analysis_jobs SET state=? WHERE id=?").run(state, id);
      expect(sweepPendingAnalysis(ws.db)).toEqual([]);
    }
  }, 120_000);
});

describe("the cap HOLDS a session; it never fails one (criterion 8)", () => {
  function seedHalted(): { db: ReturnType<typeof openDatabase>; sessionId: string; jobId: string } {
    ws = workspace();
    const { sessionId } = ws.seed([{ kind: "tone", seconds: 1 }]);
    // The state a capped session is really in: ingest finished, speech extracted,
    // and the run stopped at its first refused reservation having made no call.
    ws.db.prepare("UPDATE ingest_jobs SET state='done', stage='done', progress=1 WHERE session_id=?").run(sessionId);
    upsertSegment(ws.db, { sessionId, idx: 0, startMs: 0, endMs: 1000, contentHash: `${sessionId}-h0` });
    const job = enqueueAnalysis(ws.db, sessionId);
    ws.db
      .prepare("UPDATE analysis_jobs SET state='halted', error='Monthly budget reached.' WHERE id=?")
      .run(job.id);
    return { db: ws.db, sessionId, jobId: job.id };
  }

  it("resumes a halted run once there is headroom, without the learner re-uploading", () => {
    const { db, jobId } = seedHalted();
    writeSettings(db, { monthlyBudgetUsd: 10 });
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "x", costUsd: 2 }); // headroom exists

    expect(resumeHaltedAnalysis(db, { cooldownMs: 0 })).toEqual([jobId]);
    const after = db.prepare("SELECT state, error FROM analysis_jobs WHERE id=?").get(jobId) as {
      state: string;
      error: string | null;
    };
    expect(after.state).toBe("queued");
    // The stale halt message goes with the state — a running job that still says
    // "budget reached" is a claim that is no longer true.
    expect(after.error).toBeNull();
    // The SAME job is resumed, never a second one: the cascade is checkpointed and
    // hash-cached, so resuming re-bills nothing it already paid for.
    const n = db.prepare("SELECT COUNT(*) AS n FROM analysis_jobs").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("resumes NOTHING while the cap is still reached — the cap stays hard", () => {
    const { db, jobId } = seedHalted();
    writeSettings(db, { monthlyBudgetUsd: 1 });
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "x", costUsd: 1 }); // full
    expect(monthToDateSpend(db)).toBeCloseTo(1, 9);

    expect(resumeHaltedAnalysis(db, { cooldownMs: 0 })).toEqual([]);
    const after = db.prepare("SELECT state FROM analysis_jobs WHERE id=?").get(jobId) as { state: string };
    expect(after.state).toBe("halted");
  });

  it("respects a cooldown, so a halt/re-queue cycle cannot spin", () => {
    const { db } = seedHalted();
    writeSettings(db, { monthlyBudgetUsd: 10 });
    // With headroom but a live cooldown, a job just touched is left alone.
    expect(resumeHaltedAnalysis(db, { cooldownMs: 60_000 })).toEqual([]);
  });

  it("a held session still reads as in flight, so the home keeps watching it", () => {
    const { db, sessionId } = seedHalted();
    const item = listSessionItems(db).find((s) => s.id === sessionId)!;
    expect(sessionPhase(item)).toBe("budget-reached");
    expect(isInFlight("budget-reached")).toBe(true);
  });
});

describe("a missing key is a permanent condition, described as one (criterion 9)", () => {
  it("the message and the predicate that recognises it agree — one rule, one file", () => {
    // Producer and predicate live together in lib/analysis-key.ts precisely so they
    // cannot drift; this is the pairing assertion that proves they have not.
    expect(isMissingKeyMessage(analysisUnavailableMessage())).toBe(true);
    expect(analysisUnavailableMessage()).toContain(REQUIRED_KEY);
    // And it does not match some OTHER failure, or every failure would read as
    // "add a key" and the distinction would be worthless.
    expect(isMissingKeyMessage("gpt-audio call failed: 500")).toBe(false);
    expect(isMissingKeyMessage(null)).toBe(false);
    expect(isMissingKeyMessage(undefined)).toBe(false);
  });

  it("never promises transience for something nothing changes on its own", () => {
    const message = analysisUnavailableMessage();
    for (const weasel of [/right now/i, /just now/i, /temporarily/i, /try again later/i]) {
      expect(message).not.toMatch(weasel);
    }
    // It names the fix instead.
    expect(message).toMatch(/\.env\.local/);
  });
});

describe("the home stops watching when there is nothing left to watch (criterion 4)", () => {
  const item = (over: Partial<SessionListItem>): SessionListItem =>
    ({
      id: "s",
      originalFilename: "a.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 1,
      createdAt: "2026-07-25 21:30:00",
      capturedAt: "2026-07-25 08:10:00",
      jobState: "done",
      excludeFromEvidence: false,
      segmentCount: 1,
      analysed: false,
      sessionYield: null,
      ingestStage: null,
      ingestError: null,
      analysisState: "idle",
      analysisProgress: 0,
      analysisError: null,
      workerAbsent: false,
      analysisNeedsKey: false,
      ...over,
    }) as SessionListItem;

  it("keeps polling while any recording is still moving", () => {
    expect(anyInFlight([item({ jobState: "queued" })])).toBe(true);
    expect(anyInFlight([item({ jobState: "processing" })])).toBe(true);
    expect(anyInFlight([item({})])).toBe(true); // ingested, analysis not started
    expect(anyInFlight([item({ analysisState: "processing" })])).toBe(true);
    expect(anyInFlight([item({ analysisState: "halted" })])).toBe(true); // the worker resumes it
  });

  it("stops once every recording has settled — a finished screen makes no requests", () => {
    const settled: Partial<SessionListItem>[] = [
      { analysed: true, sessionYield: { findingsCount: 0, dominantCategory: null, segmentCount: 1, analysedSegmentCount: 1 } },
      { jobState: "failed" },
      { segmentCount: 0 },
      { analysisState: "failed", analysisNeedsKey: true },
      { analysisState: "failed", analysisError: "boom" },
    ];
    for (const s of settled) expect(anyInFlight([item(s)])).toBe(false);
    expect(anyInFlight([])).toBe(false);
    // …and one unsettled row among settled ones keeps the whole screen watching.
    expect(anyInFlight([item(settled[0]), item({ jobState: "queued" })])).toBe(true);
  });

  it("every phase is classified — no phase is silently neither in flight nor settled", () => {
    const phases = [
      "ingest-queued", "ingesting", "ingest-failed", "no-speech", "analysis-queued",
      "analysing", "needs-key", "budget-reached", "analysis-failed", "analysed",
    ] as const;
    for (const p of phases) expect(typeof isInFlight(p)).toBe("boolean");
    // The five that must keep the screen alive, named explicitly rather than inferred.
    expect(phases.filter((p) => isInFlight(p))).toEqual([
      "ingest-queued", "ingesting", "analysis-queued", "analysing", "budget-reached",
    ]);
  });
});

describe("nothing on the capture path shows a price (criterion 7)", () => {
  it("the pre-run estimate route is gone", () => {
    // Money left the flow. Settings keeps the budget input and the month-to-date
    // figure — one place, not fourteen — and states the standing cost in prose.
    expect(fs.existsSync(path.join(process.cwd(), "app/api/sessions/[id]/analysis/estimate/route.ts"))).toBe(
      false,
    );
  });
});
