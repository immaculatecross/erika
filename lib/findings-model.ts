import type { Db } from "./db";
import type { Category, Finding, FindingRow, FindingWithSession, Severity } from "./analysis/findings";
import { toFinding } from "./analysis/findings";

// THE canonical findings read-model (E-17). One place answers "what are the
// user's findings?" — every surface that asks (the session report, the Focus map,
// the editor's letter, the Phrasebook, the Archive, the lesson patterns, card
// generation) reads it here and none carries a gate of its own.
//
// Why this file exists. Six surfaces used to answer the same question six ways,
// and they disagreed: Focus and the letter looped over sessions whose *latest
// analysis job* was `done`, while the Phrasebook, Archive, patterns and cards read
// the `findings` table flat. So enqueueing a re-analysis (the latest job flips to
// `queued`) or hitting the budget cap (`halted`) deleted a whole session from
// Focus and the letter while it stayed in the Phrasebook — the letter could report
// 3 findings for a week the Phrasebook showed 9 of.
//
// The semantics, chosen once and stated here:
//
//   * An **analysed segment** is the atom: a speech segment whose audio carries a
//     complete `segment_analyses` witness — triaged, deep-listened if triage
//     flagged it, and not `unreadable`. This is `isSegmentComplete` expressed in
//     SQL, and it is the only thing that means "a model actually listened to this".
//   * An **included finding** is one whose own audio is analysed — its
//     `content_hash` carries that witness. So a finding counts from the moment the
//     run that produced it committed it (findings and the witness are written in
//     one transaction, lib/analysis/findings.ts), and no later process state
//     un-says it.
//   * An **analysed session** is a session an analysis run OF ITS OWN has run on
//     (≥1 `analysis_jobs` row past `queued`) that has at least one analysed
//     segment; its **analysed speech** is the Σ duration of *those* segments only
//     — never the whole session's speech. A rate's denominator must be what was
//     listened to, not what was recorded. The own-run requirement exists because
//     the witness is keyed by content hash ACROSS sessions (the never-re-bill
//     cache): a byte-identical file uploaded as a second session shares every
//     witness with the first while nothing was ever done on it and no finding was
//     ever materialized for it — counting it would double the analysed hours and
//     halve every rate. A duplicate contributes nothing anywhere until its own
//     Analyze runs; that run is a pure cache hit that materializes its findings
//     instantly and free, and from that moment it counts.
//
// Analysis-job STATE never un-says committed evidence. A job row describes a
// *process*; the witness describes *evidence*. Gating reads on the *latest* job's
// state is precisely what produced the disagreement, and it produced it in the
// untruthful direction — hiding work the user had already paid for. The session
// scope above asks only whether ANY run of the session's own ever started, never
// what state the latest one is in. Concretely:
//
//   * a **halted** run (budget cap) counts: the segments it reached were genuinely
//     analysed, so its findings count and only its analysed speech is denominated.
//     Nothing about "we stopped early" makes the errors it found less real. The
//     completed segments of a **failed** run count the same way.
//   * a **re-analysis in flight** changes nothing while it runs: the evidence from
//     the previous run stands until the new run adds to it (a new `queued` job
//     cannot un-start the old run). Findings do not blink out of the Phrasebook,
//     the letter, or Focus because a job was enqueued.
//
// Read-only: no writes, no model calls. All aggregation is done by SQL `GROUP BY`
// over a fixed number of statements — never one query per session.

/** Predicate on a joined `segment_analyses` row `a`: this audio was analysed. */
const WITNESS_COMPLETE = "a.content_hash IS NOT NULL AND a.unreadable = 0 AND (a.flagged = 0 OR a.deep_done = 1)";

/**
 * The atom, as an `EXISTS` clause over whatever column holds a content hash: the
 * audio behind it carries a complete analysis witness. Everything below is this
 * one predicate applied to the join each surface needs — a finding's own hash for
 * the finding scopes, a session's segments for the speech denominator.
 */
function hashIsAnalysed(hashColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM segment_analyses a
     WHERE a.content_hash = ${hashColumn} AND ${WITNESS_COMPLETE}
  )`;
}

/**
 * Predicate on a session id expression: an analysis run of THIS session's own has
 * actually run — any job past `queued`, whatever its state ended up as. This is
 * the per-session evidence gate for the session scopes: the witness alone is
 * hash-shared across sessions, so without it a byte-identical re-upload would
 * read as analysed without any run of its own ever committing anything. It is an
 * EXISTS over ALL of the session's jobs, deliberately not a read of the latest
 * one — gating on the latest job's state is the pre-E-17 bug.
 */
function sessionHasOwnRun(sessionIdExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM analysis_jobs j
     WHERE j.session_id = ${sessionIdExpr} AND j.state <> 'queued'
  )`;
}

/**
 * SQL fragment: the included-finding scope, for any query over `findings f`. The
 * one gate every finding-reading surface uses — the session report, the
 * Phrasebook, the Archive, the lesson patterns, card generation, and (through
 * `findingTallies`) Focus and the letter. No own-run check is needed here: a
 * `findings` row is only ever written by the session's own run (directly or by
 * cache reuse), so the row's existence is itself the per-session evidence.
 */
export const INCLUDED_FINDING_SCOPE = hashIsAnalysed("f.content_hash");

/** One analysed session, with the speech that was actually listened to. */
export interface AnalysedSessionRow {
  id: string;
  /** SQLite UTC `created_at` — the chronological / ISO-week key. */
  createdAt: string;
  /** Σ duration of this session's ANALYSED segments, in ms (the denominator). */
  analysedSpeechMs: number;
  /** Every speech segment the session has. */
  segmentCount: number;
  /** How many of those carry a complete witness. */
  analysedSegmentCount: number;
}

/**
 * Every analysed session with its analysed speech, oldest first — ONE query, the
 * per-session sums done by SQL `GROUP BY` rather than a `listSegments` call per
 * session. A session with speech but nothing analysed is absent, not zero-filled —
 * and so is a session no run of its own has started on, however many witnesses its
 * hashes share with an already-analysed twin.
 */
export function listAnalysedSessions(db: Db): AnalysedSessionRow[] {
  const rows = db
    .prepare(
      `SELECT s.id AS id, s.created_at AS created_at,
              COALESCE(SUM(CASE WHEN ${WITNESS_COMPLETE} THEN sg.duration_ms ELSE 0 END), 0) AS analysed_ms,
              COUNT(sg.id) AS segment_count,
              COALESCE(SUM(CASE WHEN ${WITNESS_COMPLETE} THEN 1 ELSE 0 END), 0) AS analysed_count
         FROM sessions s
         JOIN segments sg ON sg.session_id = s.id
         LEFT JOIN segment_analyses a ON a.content_hash = sg.content_hash
        WHERE ${sessionHasOwnRun("s.id")}
        GROUP BY s.id
       HAVING analysed_count > 0
        ORDER BY s.created_at, s.id`,
    )
    .all() as { id: string; created_at: string; analysed_ms: number; segment_count: number; analysed_count: number }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    analysedSpeechMs: r.analysed_ms,
    segmentCount: r.segment_count,
    analysedSegmentCount: r.analysed_count,
  }));
}

/** How many findings a session has of one category at one severity. */
export interface FindingTally {
  sessionId: string;
  category: Category;
  severity: Severity;
  count: number;
}

/**
 * The per-session / per-category / per-severity counts of every included finding
 * — ONE `GROUP BY` query, and the only aggregate Focus and the letter need for
 * their rates and their severity-weighted ranking. The counting happens in SQLite;
 * nothing reads a quote or an explanation to compute a rate.
 */
export function findingTallies(db: Db): FindingTally[] {
  const rows = db
    .prepare(
      `SELECT f.session_id AS session_id, f.category AS category, f.severity AS severity, COUNT(*) AS n
         FROM findings f
        WHERE ${INCLUDED_FINDING_SCOPE}
        GROUP BY f.session_id, f.category, f.severity
        ORDER BY f.session_id, f.category, f.severity`,
    )
    .all() as { session_id: string; category: Category; severity: Severity; n: number }[];
  return rows.map((r) => ({ sessionId: r.session_id, category: r.category, severity: r.severity, count: r.n }));
}

/**
 * Every included finding, newest first (insertion time, ties by id) — the
 * Phrasebook's library and the lesson engine's source material, one query.
 */
export function listIncludedFindings(db: Db): Finding[] {
  const rows = db
    .prepare(`SELECT f.* FROM findings f WHERE ${INCLUDED_FINDING_SCOPE} ORDER BY f.created_at DESC, f.id`)
    .all() as FindingRow[];
  return rows.map(toFinding);
}

/**
 * Every included finding joined to its session's capture date and name — the
 * Archive's chronological source. Base order only; the pure archive builder owns
 * the display order.
 */
export function listIncludedFindingsWithSession(db: Db): FindingWithSession[] {
  const rows = db
    .prepare(
      `SELECT f.*, s.created_at AS session_created_at, s.original_filename AS session_filename
         FROM findings f JOIN sessions s ON s.id = f.session_id
        WHERE ${INCLUDED_FINDING_SCOPE}
        ORDER BY s.created_at DESC, f.session_id, f.start_ms, f.id`,
    )
    .all() as (FindingRow & { session_created_at: string; session_filename: string })[];
  return rows.map((r) => ({
    ...toFinding(r),
    sessionCreatedAt: r.session_created_at,
    sessionFilename: r.session_filename,
  }));
}

/**
 * One session's included findings, in timeline order — the session report. Same
 * scope as every other surface, narrowed to one session, so the report and the
 * Phrasebook can never show a different set for the same recording.
 */
export function listSessionFindings(db: Db, sessionId: string): Finding[] {
  const rows = db
    .prepare(
      `SELECT f.* FROM findings f
        WHERE f.session_id = ? AND ${INCLUDED_FINDING_SCOPE}
        ORDER BY f.start_ms, f.id`,
    )
    .all(sessionId) as FindingRow[];
  return rows.map(toFinding);
}

/** One session's segment truth — what the report's tally line states (E-17.5). */
export interface SessionSegmentCounts {
  segmentCount: number;
  /** Segments carrying a complete witness — the only ones a model has heard. */
  analysedCount: number;
  /** Segments whose model reply could not be read even after the repair retry. */
  unreadableCount: number;
}

/**
 * The truthful per-session counts, in one query. `analysed` is counted from the
 * witnesses, NOT derived as `segmentCount − unreadableCount`: that subtraction is
 * exact only on a run that finished, and on a halted run it silently credited
 * every segment the run never reached ("5 of 6 analysed" when 1 had been). And
 * the witness counts apply only once a run of the SESSION'S OWN has started —
 * witnesses are hash-shared across sessions, and a byte-identical re-upload no
 * run has touched must not report its segments as analysed.
 */
export function sessionSegmentCounts(db: Db, sessionId: string): SessionSegmentCounts {
  const r = db
    .prepare(
      `SELECT COUNT(sg.id) AS total,
              COALESCE(SUM(CASE WHEN ${WITNESS_COMPLETE} THEN 1 ELSE 0 END), 0) AS analysed,
              COALESCE(SUM(CASE WHEN a.unreadable = 1 THEN 1 ELSE 0 END), 0) AS unreadable,
              ${sessionHasOwnRun("?")} AS has_run
         FROM segments sg
         LEFT JOIN segment_analyses a ON a.content_hash = sg.content_hash
        WHERE sg.session_id = ?`,
    )
    .get(sessionId, sessionId) as { total: number; analysed: number; unreadable: number; has_run: number };
  return r.has_run
    ? { segmentCount: r.total, analysedCount: r.analysed, unreadableCount: r.unreadable }
    : { segmentCount: r.total, analysedCount: 0, unreadableCount: 0 };
}
