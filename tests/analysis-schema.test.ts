import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession, deleteSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, listFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { recordSpend, monthToDateSpend } from "@/lib/analysis/budget";

// Migration v4: the new tables exist, findings/analysis_jobs cascade on session
// delete, and the hash-keyed spend ledger is deliberately retained across a
// delete so spend history — and the budget cap — cannot be evaded.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-schema-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("migration v4 schema", () => {
  it("creates the analysis tables", () => {
    const db = freshDb();
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
    );
    for (const t of ["findings", "analysis_jobs", "segment_analyses", "spend_ledger"]) {
      expect(tables.has(t)).toBe(true);
    }
    db.close();
  });

  it("cascades findings and analysis_jobs on session delete but retains the ledger", () => {
    const db = freshDb();
    createSession(db, { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    upsertSegment(db, { sessionId: "s1", idx: 0, startMs: 0, endMs: 60_000, contentHash: "h0" });
    persistSegmentFindings(db, {
      sessionId: "s1",
      contentHash: "h0",
      flagged: true,
      deepDone: true,
      findings: [
        { quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "low", startMs: 0, endMs: 100 },
      ],
    });
    enqueueAnalysis(db, "s1");
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "h0", costUsd: 0.5 });
    expect(listFindings(db, "s1")).toHaveLength(1);

    deleteSession(db, "s1");
    expect(listFindings(db, "s1")).toEqual([]); // cascaded
    expect((db.prepare("SELECT COUNT(*) AS n FROM analysis_jobs").get() as { n: number }).n).toBe(0); // cascaded
    expect(monthToDateSpend(db)).toBe(0.5); // ledger retained — spend history survives
    db.close();
  });
});
