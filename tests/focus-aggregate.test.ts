import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession, listSessions } from "@/lib/sessions";
import { listSegments, upsertSegment } from "@/lib/segments";
import { listFindings, persistSegmentFindings, type Category, type Severity } from "@/lib/analysis/findings";
import { enqueueAnalysis, getAnalysisJobBySession } from "@/lib/analysis/cascade";
import { buildFocusModel, computeFocus, type AnalyzedSession } from "@/lib/focus";
import { buildLetter, computeLetter, isoWeekStart, type LetterFinding, type LetterSession } from "@/lib/letter";

// E-17 criterion 2: Focus and the letter now collect through the canonical
// read-model with two SQL `GROUP BY` queries each, instead of three queries per
// session on every GET (`getAnalysisJobBySession` + `listSegments` +
// `listFindings`, in a loop over every session in the database).
//
// The evidence here is old-vs-new equivalence: `legacyCollect*` below are the
// pre-E-17 collectors transcribed verbatim, and on a fixture where the semantics
// did NOT change — multi-session, multi-week, every run cleanly `done` — the two
// must produce byte-identical models. The cases where the semantics deliberately
// DID change (a halted run, a re-analysis in flight) are covered in
// findings-truth.test.ts; the last test here pins that divergence explicitly so
// the difference between "the rewrite changed a result" and "the milestone changed
// a rule" is never guesswork.

const HOUR = 3_600_000;
const WEEK_A = "2026-06-29"; // Mondays
const WEEK_B = "2026-07-06";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-aggregate-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

// ── the pre-E-17 collectors, verbatim ────────────────────────────────────────

/** lib/focus.ts@2b5d0a7 `collectAnalyzedSessions`. */
function legacyCollectFocus(db: Db): AnalyzedSession[] {
  const rows: AnalyzedSession[] = [];
  for (const s of listSessions(db)) {
    const job = getAnalysisJobBySession(db, s.id);
    if (!job || job.state !== "done") continue;
    const speechMs = listSegments(db, s.id).reduce((sum, seg) => sum + seg.durationMs, 0);
    const findings = listFindings(db, s.id).map((f) => ({ category: f.category, severity: f.severity }));
    rows.push({ id: s.id, createdAt: s.createdAt, speechMs, findings });
  }
  return rows;
}

/** lib/letter.ts@2b5d0a7 `collectLetterSessions`. */
function legacyCollectLetter(db: Db): LetterSession[] {
  const rows: LetterSession[] = [];
  for (const s of listSessions(db)) {
    const job = getAnalysisJobBySession(db, s.id);
    if (!job || job.state !== "done") continue;
    const speechMs = listSegments(db, s.id).reduce((sum, seg) => sum + seg.durationMs, 0);
    const findings: LetterFinding[] = listFindings(db, s.id).map((f) => ({
      id: f.id,
      quote: f.quote,
      correction: f.correction,
      explanation: f.explanation,
      category: f.category,
      severity: f.severity,
    }));
    rows.push({ id: s.id, createdAt: s.createdAt, speechMs, findings });
  }
  return rows;
}

// ── the fixture ──────────────────────────────────────────────────────────────

interface Seed {
  id: string;
  day: string;
  /** One entry per segment: its ms, and the findings that segment produced. */
  segments: { ms: number; findings: [Category, Severity][] }[];
}

/** Seed a cleanly-analysed session: every segment carries a complete witness. */
function seed(db: Db, s: Seed): void {
  createSession(db, { id: s.id, originalFilename: `${s.id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${s.day} 09:00:00`, s.id);
  let at = 0;
  s.segments.forEach((seg, i) => {
    const hash = `${s.id}-h${i}`;
    upsertSegment(db, { sessionId: s.id, idx: i, startMs: at, endMs: at + seg.ms, contentHash: hash });
    persistSegmentFindings(db, {
      sessionId: s.id,
      contentHash: hash,
      flagged: true,
      deepDone: true,
      findings: seg.findings.map(([category, severity], n) => ({
        quote: `${s.id}-q${i}-${n}`,
        correction: `${s.id}-c${i}-${n}`,
        category,
        explanation: "why",
        severity,
        startMs: at + n * 10,
        endMs: at + n * 10 + 5,
      })),
    });
    at += seg.ms;
  });
  const job = enqueueAnalysis(db, s.id);
  db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
}

/** Multi-session, multi-week, mixed categories/severities, plus two edge cases. */
function seedCorpus(db: Db): void {
  seed(db, {
    id: "a1",
    day: WEEK_A,
    segments: [
      { ms: HOUR, findings: [["grammar", "high"], ["grammar", "low"], ["idiom", "medium"]] },
      { ms: HOUR / 2, findings: [["vocabulary", "high"]] },
    ],
  });
  seed(db, { id: "a2", day: "2026-07-01", segments: [{ ms: HOUR * 2, findings: [["phrasing", "medium"]] }] });
  seed(db, {
    id: "b1",
    day: WEEK_B,
    segments: [
      { ms: HOUR, findings: [["pronunciation", "high"], ["grammar", "medium"]] },
      { ms: HOUR, findings: [] }, // an analysed segment that found nothing
    ],
  });
  // Edge: a session whose speech time is zero — every rate must read 0, not NaN,
  // and it must be present or absent identically in both implementations.
  seed(db, { id: "zero", day: WEEK_B, segments: [{ ms: 0, findings: [["grammar", "low"]] }] });
}

describe("E-17 criterion 2 — SQL aggregates equal the per-session loop", () => {
  it("Focus: the whole model is identical over a multi-session, multi-week corpus", () => {
    const db = freshDb();
    seedCorpus(db);
    expect(buildFocusModel(db)).toEqual(computeFocus(legacyCollectFocus(db)));
    expect(buildFocusModel(db).analyzedSessions).toBe(4); // the fixture is not empty
    db.close();
  });

  it("the letter is identical for every week, including the single-week case", () => {
    const db = freshDb();
    seedCorpus(db);
    const legacy = legacyCollectLetter(db);
    for (const week of [WEEK_A, WEEK_B]) {
      expect(buildLetter(db, week)).toEqual(computeLetter(legacy, week));
    }
    // The latest week, chosen by each implementation for itself.
    expect(buildLetter(db)).toEqual(computeLetter(legacy));
    expect(buildLetter(db)?.weekStart).toBe(WEEK_B);
    db.close();
  });

  it("the zero-speech session is treated identically (rates 0, never NaN)", () => {
    const db = freshDb();
    seed(db, { id: "zero", day: WEEK_A, segments: [{ ms: 0, findings: [["grammar", "low"]] }] });
    const model = buildFocusModel(db);
    expect(model).toEqual(computeFocus(legacyCollectFocus(db)));
    expect(model.speechHours).toBe(0);
    expect(model.overallRatePerHour).toBe(0);
    expect(Number.isNaN(model.overallRatePerHour)).toBe(false);
    expect(isoWeekStart(`${WEEK_A} 09:00:00`)).toBe(WEEK_A);
    db.close();
  });

  it("the query count is constant in the number of sessions", () => {
    const db = freshDb();
    for (let i = 0; i < 3; i++) {
      seed(db, { id: `s${i}`, day: WEEK_A, segments: [{ ms: HOUR, findings: [["grammar", "high"]] }] });
    }
    const count = (fn: () => unknown): number => {
      const real = db.prepare.bind(db);
      let n = 0;
      (db as unknown as { prepare: typeof db.prepare }).prepare = ((sql: string) => {
        n++;
        return real(sql);
      }) as typeof db.prepare;
      try {
        fn();
      } finally {
        (db as unknown as { prepare: typeof db.prepare }).prepare = real;
      }
      return n;
    };

    const withThree = count(() => buildFocusModel(db));
    const legacyThree = count(() => legacyCollectFocus(db));
    for (let i = 3; i < 9; i++) {
      seed(db, { id: `s${i}`, day: WEEK_A, segments: [{ ms: HOUR, findings: [["grammar", "high"]] }] });
    }
    expect(count(() => buildFocusModel(db))).toBe(withThree); // 9 sessions, same queries
    expect(count(() => legacyCollectFocus(db))).toBeGreaterThan(legacyThree); // the old loop scales
    db.close();
  });

  it("the two implementations diverge ONLY where the milestone changed the rule", () => {
    const db = freshDb();
    seed(db, { id: "halted", day: WEEK_A, segments: [{ ms: HOUR, findings: [["grammar", "high"]] }] });
    // Same session, same evidence — only the job's state differs.
    db.prepare("UPDATE analysis_jobs SET state='halted' WHERE session_id='halted'").run();

    expect(computeFocus(legacyCollectFocus(db)).totalFindings).toBe(0); // the old answer
    expect(buildFocusModel(db).totalFindings).toBe(1); // the truthful one

    // And with a re-analysis enqueued on top of a completed run. The new job's
    // `created_at` is pinned rather than left to `datetime('now')`: two jobs in
    // the same second tie, and `getAnalysisJobBySession` then breaks the tie on a
    // random UUID — so the legacy behaviour was itself a coin flip within a second.
    db.prepare("UPDATE analysis_jobs SET state='done' WHERE session_id='halted'").run();
    db.prepare(
      "INSERT INTO analysis_jobs (id, session_id, state, created_at) VALUES ('rerun', 'halted', 'queued', '2030-01-01 00:00:00')",
    ).run();
    expect(computeFocus(legacyCollectFocus(db)).totalFindings).toBe(0);
    expect(buildFocusModel(db).totalFindings).toBe(1);
    db.close();
  });
});
