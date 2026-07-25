import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { analysisUnavailableMessage } from "@/lib/analysis-key";
import { listSessionItems } from "@/lib/session-yield";
import { sessionPhase } from "@/lib/sessions-list-view";

// E-18 criterion 2 / E-42 criterion 2: the sessions list reads each session's yield
// through the canonical read-model, and `sessionPhase` says truthfully where a
// recording is up to.
//
// The gate this file used to test — `analyzeGate`, which decided whether to OFFER an
// Analyze button — is gone with the button (E-42). What replaces it is not an
// affordance question but a state question, and the same discipline applies: every
// pipeline position has exactly one phase, and no phase claims work that is not
// happening.

const HOUR = 3_600_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-yield-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

function addSession(db: Db, id: string, ingestState = "done"): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE ingest_jobs SET state = ? WHERE session_id = ?").run(ingestState, id);
}

function addSegments(db: Db, id: string, n: number): void {
  for (let i = 0; i < n; i++) {
    upsertSegment(db, { sessionId: id, idx: i, startMs: i * HOUR, endMs: (i + 1) * HOUR, contentHash: `${id}-h${i}` });
  }
}

/** Witness segment i of `id` as analysed, carrying findings of the given categories. */
function analyseSegment(db: Db, id: string, i: number, categories: Category[]): void {
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h${i}`,
    flagged: true,
    deepDone: true,
    findings: categories.map((category, j) => ({
      quote: `${id}-${i}-q${j}`,
      correction: "c",
      category,
      explanation: "why",
      severity: "high",
      startMs: j * 1000,
      endMs: j * 1000 + 500,
    })),
  });
}

function runJob(db: Db, id: string, state: string): void {
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = ?, progress = 1 WHERE id = ?").run(state, job.id);
}

const item = (db: Db, id: string) => listSessionItems(db).find((s) => s.id === id)!;

describe("listSessionItems — session yield (criterion 2)", () => {
  it("states analysed speech, findings count and dominant category for an analysed session", () => {
    const db = freshDb();
    addSession(db, "a");
    addSegments(db, "a", 3);
    analyseSegment(db, "a", 0, ["grammar", "grammar", "vocabulary"]);
    analyseSegment(db, "a", 1, ["grammar"]);
    runJob(db, "a", "done");

    const it_ = item(db, "a");
    expect(it_.analysed).toBe(true);
    // Only the 2 witnessed segments denominate — the 3rd was never heard.
    expect(it_.sessionYield).toEqual({
      findingsCount: 4,
      dominantCategory: "grammar",
      // Only the 2 witnessed segments were heard — the qualifier that stops "no
      // mistakes found" reading as a clean bill of health on unheard audio.
      segmentCount: 3,
      analysedSegmentCount: 2,
    });
    expect(it_.segmentCount).toBe(3);
  });

  it("breaks a dominant-category tie by the canonical category order", () => {
    const db = freshDb();
    addSession(db, "t");
    addSegments(db, "t", 1);
    // vocabulary and grammar tie 2–2; CATEGORY_ORDER puts grammar first.
    analyseSegment(db, "t", 0, ["vocabulary", "grammar", "vocabulary", "grammar"]);
    runJob(db, "t", "done");
    expect(item(db, "t").sessionYield!.dominantCategory).toBe("grammar");
  });

  it("reports an analysed session with zero findings truthfully (no category)", () => {
    const db = freshDb();
    addSession(db, "z");
    addSegments(db, "z", 1);
    analyseSegment(db, "z", 0, []);
    runJob(db, "z", "done");
    expect(item(db, "z").sessionYield).toEqual({
      findingsCount: 0,
      dominantCategory: null,
      segmentCount: 1,
      analysedSegmentCount: 1,
    });
  });

  it("a halted run still yields — committed evidence is never un-said (E-17 semantics)", () => {
    const db = freshDb();
    addSession(db, "h");
    addSegments(db, "h", 4);
    analyseSegment(db, "h", 0, ["idiom"]);
    runJob(db, "h", "halted");
    const it_ = item(db, "h");
    expect(it_.analysed).toBe(true);
    expect(it_.sessionYield).toEqual({
      findingsCount: 1,
      dominantCategory: "idiom",
      segmentCount: 4,
      analysedSegmentCount: 1,
    });
  });
});

describe("sessionPhase — one truthful position, never a false affordance (E-42 criterion 2)", () => {
  it("an ingested session with speech and no run yet is WAITING, not idle-looking", () => {
    const db = freshDb();
    addSession(db, "ok");
    addSegments(db, "ok", 2);
    // No analysis job exists yet — the worker's sweep queues one within a tick, so
    // "waiting to be listened to" is the honest word for both `idle` and `queued`.
    expect(sessionPhase(item(db, "ok"))).toBe("analysis-queued");
  });

  it("a session with no segments says so — a $0 run would report a clean bill of health", () => {
    const db = freshDb();
    addSession(db, "empty"); // ingest done, zero speech found
    expect(sessionPhase(item(db, "empty"))).toBe("no-speech");
  });

  it("distinguishes a failed ingest from one still queued and one in flight", () => {
    const db = freshDb();
    addSession(db, "failed", "failed");
    addSession(db, "queued", "queued");
    addSession(db, "processing", "processing");
    expect(sessionPhase(item(db, "failed"))).toBe("ingest-failed");
    expect(sessionPhase(item(db, "queued"))).toBe("ingest-queued");
    expect(sessionPhase(item(db, "processing"))).toBe("ingesting");
  });

  it("a run in flight reads as listening, and carries its real completion ratio", () => {
    const db = freshDb();
    addSession(db, "r");
    addSegments(db, "r", 4);
    const job = enqueueAnalysis(db, "r");
    db.prepare("UPDATE analysis_jobs SET state='processing', progress=0.5 WHERE id=?").run(job.id);
    const it_ = item(db, "r");
    expect(sessionPhase(it_)).toBe("analysing");
    expect(it_.analysisProgress).toBe(0.5);
  });

  it("a run the cap halted is HELD, not failed — a distinct phase with its own way out", () => {
    const db = freshDb();
    addSession(db, "cap");
    addSegments(db, "cap", 2);
    runJob(db, "cap", "halted");
    expect(sessionPhase(item(db, "cap"))).toBe("budget-reached");
  });

  it("a run refused for want of a key is its own phase — permanent, not 'failed'", () => {
    const db = freshDb();
    addSession(db, "nokey");
    addSegments(db, "nokey", 1);
    const job = enqueueAnalysis(db, "nokey");
    db.prepare("UPDATE analysis_jobs SET state='failed', error=? WHERE id=?").run(
      analysisUnavailableMessage(),
      job.id,
    );
    const it_ = item(db, "nokey");
    expect(it_.analysisNeedsKey).toBe(true);
    expect(sessionPhase(it_)).toBe("needs-key");
  });

  it("any OTHER failure stays a plain failure, so the two are never conflated", () => {
    const db = freshDb();
    addSession(db, "boom");
    addSegments(db, "boom", 1);
    const job = enqueueAnalysis(db, "boom");
    db.prepare("UPDATE analysis_jobs SET state='failed', error=? WHERE id=?").run(
      "gpt-audio call failed: 500",
      job.id,
    );
    const it_ = item(db, "boom");
    expect(it_.analysisNeedsKey).toBe(false);
    expect(sessionPhase(it_)).toBe("analysis-failed");
  });

  it("an analysed session reports its yield", () => {
    const db = freshDb();
    addSession(db, "a");
    addSegments(db, "a", 1);
    analyseSegment(db, "a", 0, ["grammar"]);
    runJob(db, "a", "done");
    expect(sessionPhase(item(db, "a"))).toBe("analysed");
  });
});
