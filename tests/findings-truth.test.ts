import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category, type NewFinding } from "@/lib/analysis/findings";
import { enqueueAnalysis, type AnalysisState } from "@/lib/analysis/cascade";
import {
  listAnalysedSessions,
  listIncludedFindings,
  listIncludedFindingsWithSession,
  listSessionFindings,
  sessionSegmentCounts,
} from "@/lib/findings-model";
import { buildFocusModel } from "@/lib/focus";
import { buildLetter } from "@/lib/letter";
import { buildEntries as buildPhrasebook } from "@/lib/phrasebook";
import { buildEntries as buildArchive } from "@/lib/archive";
import { derivePatterns } from "@/lib/lessons/patterns";
import { generateCards, listCards } from "@/lib/cards";
import { segmentTally } from "@/lib/analysis-view";

// E-17 criterion 1: the six surfaces that answer "what are the user's findings?"
// now answer it once, through lib/findings-model.ts, and agree.
//
// The two cases they used to disagree about are the two seeded here. Focus and
// the letter gated on the session's LATEST analysis job being `done`, so:
//
//   * a budget-HALTED run vanished from them entirely, while the Phrasebook, the
//     Archive, the lesson patterns and the card generator kept every finding it
//     had already paid for;
//   * enqueueing a RE-ANALYSIS flipped the latest job to `queued`, which deleted
//     a fully-analysed session from Focus and the letter for as long as the new
//     run was in flight.
//
// So the letter could report 3 findings for a week the Phrasebook showed 9 of.
// Every surface below is driven through its own composition path — not through a
// shared helper — so the assertion is that the *surfaces* agree, not that one
// function equals itself.

const HOUR = 3_600_000;
const WEEK = "2026-07-13"; // a Monday: all seeds fall in one ISO week

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-truth-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

function finding(i: number, category: Category = "grammar"): NewFinding {
  return {
    quote: `q${i}`,
    correction: `c${i}`,
    category,
    explanation: "why",
    severity: "high",
    startMs: i * 1000,
    endMs: i * 1000 + 500,
  };
}

/**
 * Seed one session as a run would leave it: `segments` for every extracted speech
 * interval, an analysis witness (and findings) for the `analysed` ones only, and a
 * job in `state`. `segments` is the total the ingest produced.
 */
function seed(
  db: Db,
  id: string,
  opts: { segments: number; analysed: number; state: AnalysisState; extraJob?: AnalysisState },
): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${WEEK} 09:00:00`, id);
  for (let i = 0; i < opts.segments; i++) {
    upsertSegment(db, {
      sessionId: id,
      idx: i,
      startMs: i * HOUR,
      endMs: (i + 1) * HOUR,
      contentHash: `${id}-h${i}`,
    });
  }
  for (let i = 0; i < opts.analysed; i++) {
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: `${id}-h${i}`,
      flagged: true,
      deepDone: true,
      findings: [finding(i)],
    });
  }
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = ?, progress = 1 WHERE id = ?").run(opts.state, job.id);
  if (opts.extraJob) {
    // A *newer* job — what pressing Analyze again writes. `getAnalysisJobBySession`
    // returns this one, which is exactly what used to erase the session.
    const next = db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES (?, ?, ?)");
    next.run(`${id}-rerun`, id, opts.extraJob);
  }
}

/** What each surface says the user's findings are, through its own entry point. */
function surfaceCounts(db: Db): Record<string, number> {
  const focus = buildFocusModel(db);
  const letter = buildLetter(db, WEEK);
  const cardsBefore = listCards(db).length;
  const created = generateCards(db);
  return {
    focus: focus.totalFindings,
    letter: letter?.totalFindings ?? 0,
    phrasebook: buildPhrasebook(listIncludedFindings(db), new Set()).length,
    archive: buildArchive(
      listIncludedFindingsWithSession(db).map((f) => ({ ...f, id: f.id })),
    ).length,
    // The lesson engine filters the shared set further (a category needs
    // PATTERN_THRESHOLD findings to be a pattern), so every fixture here is
    // single-category and at/above that threshold — otherwise the filter, not the
    // scope, would decide the number and a scope difference could hide behind it.
    patterns: derivePatterns(listIncludedFindings(db)).reduce((n, p) => n + p.count, 0),
    cards: cardsBefore + created,
  };
}

describe("E-17 criterion 1 — one findings truth", () => {
  it("a budget-halted run reads the same on all six surfaces", () => {
    const db = freshDb();
    // 6 segments extracted; the cap stopped the run after 3. Before E-17: the
    // Phrasebook/Archive/patterns/cards showed 3 findings and Focus/the letter
    // showed zero, because the latest job is `halted`, not `done`.
    seed(db, "halted", { segments: 6, analysed: 3, state: "halted" });

    const counts = surfaceCounts(db);
    expect(new Set(Object.values(counts)).size).toBe(1); // one number, six surfaces
    expect(counts.focus).toBe(3);
    // The rate is denominated on the 3 hours actually listened to, not the 6
    // extracted — the halt must not read as an improvement.
    expect(buildFocusModel(db).speechHours).toBe(3);
    expect(buildFocusModel(db).overallRatePerHour).toBe(1);
    db.close();
  });

  it("a re-analysis in flight changes nothing anywhere", () => {
    const db = freshDb();
    seed(db, "rerun", { segments: 3, analysed: 3, state: "done" });
    const before = surfaceCounts(db);

    // Press Analyze again: the latest job is now `queued`.
    seed(db, "rerun2", { segments: 0, analysed: 0, state: "done" }); // unrelated noise
    const job = enqueueAnalysis(db, "rerun");
    expect(job.state).toBe("queued");

    const after = surfaceCounts(db);
    expect(after).toEqual(before);
    expect(after.focus).toBe(3);
    expect(new Set(Object.values(after)).size).toBe(1);
    db.close();
  });

  it("the session report agrees with the cross-session surfaces", () => {
    const db = freshDb();
    seed(db, "halted", { segments: 6, analysed: 3, state: "halted" });
    expect(listSessionFindings(db, "halted")).toHaveLength(3);
    expect(listSessionFindings(db, "halted").map((f) => f.id).sort()).toEqual(
      listIncludedFindings(db).map((f) => f.id).sort(),
    );
    db.close();
  });

  it("a session nothing has listened to contributes nothing", () => {
    const db = freshDb();
    seed(db, "ingested-only", { segments: 4, analysed: 0, state: "queued" });
    expect(listAnalysedSessions(db)).toEqual([]);
    expect(listIncludedFindings(db)).toEqual([]);
    expect(buildFocusModel(db).speechHours).toBe(0);
    expect(buildLetter(db)).toBeNull();
    db.close();
  });
});

describe("E-17 criterion 5 — a halted run reports a truthful analysed count", () => {
  it("counts the segments a model heard instead of deriving it by subtraction", () => {
    const db = freshDb();
    // The review's exact shape: 6 segments, 1 analysed, 1 unreadable, 4 never
    // reached. The old `segmentCount − unreadableCount` said "5 of 6 analysed".
    seed(db, "s", { segments: 6, analysed: 1, state: "halted" });
    persistSegmentFindings(db, {
      sessionId: "s",
      contentHash: "s-h1",
      flagged: false,
      deepDone: false,
      findings: [],
      unreadable: { reason: "truncated", shape: "finish_reason=length" },
    });

    const counts = sessionSegmentCounts(db, "s");
    expect(counts).toEqual({ segmentCount: 6, analysedCount: 1, unreadableCount: 1 });
    expect(segmentTally(counts.segmentCount, counts.analysedCount, counts.unreadableCount)).toBe(
      "1 of 6 segments analysed · 1 unreadable",
    );
    expect(counts.segmentCount - counts.unreadableCount).toBe(5); // the old, false number
    db.close();
  });
});
