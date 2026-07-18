import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { listSessionItems } from "@/lib/session-yield";
import { analyzeGate } from "@/lib/sessions-list-view";

// E-18 criteria 2–3: the sessions list reads each session's yield through the
// canonical read-model (analysed speech, findings count, dominant category), and
// the inline-Analyze gate mirrors the analysis POST route's own refusals exactly
// — a session the server would 409 never shows the affordance.

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
      analysedSpeechMs: 2 * HOUR,
      findingsCount: 4,
      dominantCategory: "grammar",
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
      analysedSpeechMs: HOUR,
      findingsCount: 0,
      dominantCategory: null,
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
    expect(it_.sessionYield).toEqual({ analysedSpeechMs: HOUR, findingsCount: 1, dominantCategory: "idiom" });
  });
});

describe("analyzeGate — no false affordance (criterion 3)", () => {
  it("offers Analyze exactly when the POST route would accept it", () => {
    const db = freshDb();
    addSession(db, "ok");
    addSegments(db, "ok", 2);
    expect(analyzeGate(item(db, "ok"))).toBe("analyze");
  });

  it("gates a session with no segments exactly as the route's 409 does", () => {
    const db = freshDb();
    addSession(db, "empty"); // ingest done, zero speech found
    expect(analyzeGate(item(db, "empty"))).toBe("no-segments");
  });

  it("gates a failed or still-running ingest — nothing to analyze", () => {
    const db = freshDb();
    addSession(db, "failed", "failed");
    addSession(db, "queued", "queued");
    addSession(db, "processing", "processing");
    expect(analyzeGate(item(db, "failed"))).toBe("ingest-failed");
    expect(analyzeGate(item(db, "queued"))).toBe("ingest-pending");
    expect(analyzeGate(item(db, "processing"))).toBe("ingest-pending");
  });

  it("says a queued or processing run is running rather than offering a second press", () => {
    const db = freshDb();
    addSession(db, "r");
    addSegments(db, "r", 1);
    enqueueAnalysis(db, "r");
    expect(item(db, "r").analysisPending).toBe(true);
    expect(analyzeGate(item(db, "r"))).toBe("running");
  });

  it("an analysed session reports yield, not an affordance", () => {
    const db = freshDb();
    addSession(db, "a");
    addSegments(db, "a", 1);
    analyseSegment(db, "a", 0, ["grammar"]);
    runJob(db, "a", "done");
    expect(analyzeGate(item(db, "a"))).toBe("analysed");
  });
});
