import type { Db } from "./db";
import type { Category } from "./analysis/findings";
import { isMissingKeyMessage } from "./env-file";
import { listSessions } from "./sessions";
import { findingTallies, listAnalysedSessions } from "./findings-model";
import { CATEGORY_ORDER } from "./analysis-view";
import { workerAbsent } from "./jobs/liveness";
import type { ListAnalysisState, SessionListItem, SessionYield } from "./sessions-list-view";

// The sessions-list read model (E-18 criterion 2, extended for E-42): every session
// annotated with what its analysis yielded AND where it is up to right now — the
// ingest stage, the analysis run's state and progress, whether anything is actually
// draining its queue, and whether the wall in front of it is a missing API key.
//
// What "analysed" means is NOT decided here: it comes whole from
// lib/findings-model.ts (`listAnalysedSessions` / `findingTallies`), so this list can
// never disagree with Focus, the letter, or the session report about which sessions
// have evidence.
//
// A FIXED NUMBER OF AGGREGATE QUERIES for the whole list — never one per session.
// That constraint is why the home can now poll: the page re-reads this list about
// once a second while anything is in flight, so an O(n) query pattern would have
// turned "no manual reload" into a self-inflicted load problem.

/** Sum a session's tallies into its yield; dominant = most findings, ties by CATEGORY_ORDER. */
function toYield(
  segmentCount: number,
  analysedSegmentCount: number,
  counts: ReadonlyMap<Category, number> | undefined,
): SessionYield {
  let findingsCount = 0;
  let dominantCategory: Category | null = null;
  let best = 0;
  if (counts) {
    for (const category of CATEGORY_ORDER) {
      const n = counts.get(category) ?? 0;
      findingsCount += n;
      if (n > best) {
        best = n;
        dominantCategory = category;
      }
    }
  }
  return { findingsCount, dominantCategory, segmentCount, analysedSegmentCount };
}

/** The liveness columns a job carries, keyed by session. */
interface JobTiming {
  state: string;
  createdAt: string | null;
  updatedAt: string | null;
  heartbeatAt: string | null;
}

interface AnalysisRow extends JobTiming {
  progress: number;
  error: string | null;
}

type JobTimingRow = {
  session_id: string;
  state: string;
  created_at: string | null;
  updated_at: string | null;
  heartbeat_at: string | null;
};

function ingestTimings(db: Db): Map<string, JobTiming> {
  const rows = db
    .prepare("SELECT session_id, state, created_at, updated_at, heartbeat_at FROM ingest_jobs")
    .all() as JobTimingRow[];
  return new Map(
    rows.map((r) => [
      r.session_id,
      { state: r.state, createdAt: r.created_at, updatedAt: r.updated_at, heartbeatAt: r.heartbeat_at },
    ]),
  );
}

/**
 * The LATEST analysis run per session — the one the UI reflects, matching
 * `getAnalysisJobBySession`'s ordering exactly so the list and the detail page can
 * never describe two different runs.
 */
function latestAnalysisRuns(db: Db): Map<string, AnalysisRow> {
  const rows = db
    .prepare(
      `SELECT a.session_id, a.state, a.progress, a.error, a.created_at, a.updated_at, a.heartbeat_at
         FROM analysis_jobs a
        WHERE a.id = (SELECT b.id FROM analysis_jobs b
                       WHERE b.session_id = a.session_id
                       ORDER BY b.created_at DESC, b.id DESC LIMIT 1)`,
    )
    .all() as (JobTimingRow & { progress: number; error: string | null })[];
  return new Map(
    rows.map((r) => [
      r.session_id,
      {
        state: r.state,
        progress: r.progress,
        error: r.error,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        heartbeatAt: r.heartbeat_at,
      },
    ]),
  );
}

/**
 * Every session, newest RECORDING first, each carrying its yield when analysed and
 * its live position otherwise. Findings are read ONLY through the canonical
 * read-model's one `GROUP BY` tally.
 */
export function listSessionItems(db: Db, nowMs: number = Date.now()): SessionListItem[] {
  const sessions = listSessions(db);
  const analysed = new Map(listAnalysedSessions(db).map((s) => [s.id, s]));

  const countsBySession = new Map<string, Map<Category, number>>();
  for (const t of findingTallies(db)) {
    const bucket = countsBySession.get(t.sessionId) ?? new Map<Category, number>();
    bucket.set(t.category, (bucket.get(t.category) ?? 0) + t.count);
    countsBySession.set(t.sessionId, bucket);
  }

  const segmentCounts = new Map(
    (
      db
        .prepare("SELECT session_id AS sid, COUNT(*) AS n FROM segments GROUP BY session_id")
        .all() as { sid: string; n: number }[]
    ).map((r) => [r.sid, r.n]),
  );

  const ingestJobs = new Map(
    (db.prepare("SELECT session_id AS sid, stage, error FROM ingest_jobs").all() as {
      sid: string;
      stage: string | null;
      error: string | null;
    }[]).map((r) => [r.sid, r]),
  );

  const ingest = ingestTimings(db);
  const runs = latestAnalysisRuns(db);

  return sessions.map((s) => {
    const a = analysed.get(s.id);
    const run = runs.get(s.id);
    const analysisState: ListAnalysisState = (run?.state as ListAnalysisState) ?? "idle";
    // A run refused for want of a key is a PERMANENT condition until the learner
    // acts, so it is modelled as its own fact rather than as a generic failure
    // (criterion 9). The predicate and the message that produces it live together in
    // lib/env-file.ts, so they cannot drift into disagreeing.
    const analysisNeedsKey = analysisState === "failed" && isMissingKeyMessage(run?.error);
    // Which job is the one currently waiting on a worker? Ingest until it is done,
    // then the analysis run. Asking about a finished job would report a phantom.
    const waitingJob: JobTiming | undefined =
      s.jobState === "done" ? (run as JobTiming | undefined) : ingest.get(s.id);
    return {
      ...s,
      segmentCount: segmentCounts.get(s.id) ?? 0,
      analysed: a !== undefined,
      sessionYield: a
        ? toYield(a.segmentCount, a.analysedSegmentCount, countsBySession.get(s.id))
        : null,
      ingestStage: ingestJobs.get(s.id)?.stage ?? null,
      ingestError: ingestJobs.get(s.id)?.error ?? null,
      analysisState,
      analysisProgress: run?.progress ?? 0,
      analysisError: run?.error ?? null,
      workerAbsent: waitingJob ? workerAbsent(waitingJob, nowMs) : false,
      analysisNeedsKey,
    };
  });
}
