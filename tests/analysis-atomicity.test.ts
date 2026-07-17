import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import {
  persistSegmentFindings,
  getSegmentAnalysis,
  listFindings,
  type NewFinding,
} from "@/lib/analysis/findings";
import { monthToDateSpend } from "@/lib/analysis/budget";

// Money-safety hardening (E-4 criterion 5): the spend record and the segment's
// completion witness (+ findings) must commit in ONE transaction, so a crash
// between the two can never leave a *charge without its witness* — which would
// re-bill that segment on resume. These tests prove all-or-nothing directly.

const dirs: string[] = [];
function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-atomicity-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function seed(db: Db): void {
  createSession(db, { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
}

const okFinding: NewFinding = {
  quote: "a mistake",
  correction: "a correction",
  category: "grammar",
  explanation: "why",
  severity: "medium",
  startMs: 0,
  endMs: 1000,
};

describe("persistSegmentFindings atomicity (criterion 5)", () => {
  it("records spend and the witness together on success", () => {
    const db = ws();
    seed(db);
    persistSegmentFindings(db, {
      sessionId: "s1",
      contentHash: "h1",
      flagged: true,
      deepDone: true,
      findings: [okFinding],
      spend: { model: "gpt-audio-1.5", contentHash: "h1", costUsd: 0.06 },
    });
    expect(monthToDateSpend(db)).toBeCloseTo(0.06, 9); // charged
    expect(getSegmentAnalysis(db, "h1")).toMatchObject({ deepDone: true }); // witnessed
    expect(listFindings(db, "s1")).toHaveLength(1);
    db.close();
  });

  it("rolls the spend back when the findings/witness write fails — no charge without witness", () => {
    const db = ws();
    seed(db);
    // A category the CHECK constraint rejects makes the findings INSERT throw
    // *after* recordSpend runs inside the same transaction. Atomicity must undo
    // the charge: neither the ledger row nor the witness may survive.
    const badFinding = { ...okFinding, category: "not-a-category" as NewFinding["category"] };
    expect(() =>
      persistSegmentFindings(db, {
        sessionId: "s1",
        contentHash: "h1",
        flagged: true,
        deepDone: true,
        findings: [badFinding],
        spend: { model: "gpt-audio-1.5", contentHash: "h1", costUsd: 0.06 },
      }),
    ).toThrow();

    expect(monthToDateSpend(db)).toBe(0); // the charge was rolled back
    expect(getSegmentAnalysis(db, "h1")).toBeNull(); // no witness either
    expect(listFindings(db, "s1")).toEqual([]); // nothing half-written
    db.close();
  });
});
