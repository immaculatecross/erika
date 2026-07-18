import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { MASTERY_ALPHA, getMastery, nextMastery, recordCompletion } from "@/lib/lessons/mastery";

// WO criterion 5 — the mastery update rule. Completing a lesson at a given score
// moves the pattern's mastery by the documented EMA toward that score; the value
// is stored per pattern and persists across reloads.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-mastery-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("nextMastery (the EMA rule)", () => {
  it("moves the previous value toward the score by ALPHA and clamps to 0..1", () => {
    expect(MASTERY_ALPHA).toBe(0.5);
    expect(nextMastery(0, 1)).toBeCloseTo(0.5, 10); // fresh + perfect → ALPHA
    expect(nextMastery(0.5, 1)).toBeCloseTo(0.75, 10); // a second perfect run
    expect(nextMastery(0.8, 0)).toBeCloseTo(0.4, 10); // a failed run pulls it down
    expect(nextMastery(0, -5)).toBe(0); // out-of-range score is clamped first
    expect(nextMastery(1, 5)).toBe(1);
  });
});

describe("recordCompletion (persistence)", () => {
  it("defaults an unseen pattern to 0, then updates and persists", () => {
    const db = freshDb();
    expect(getMastery(db, "category:grammar")).toBe(0);

    expect(recordCompletion(db, "category:grammar", 1)).toBeCloseTo(0.5, 10);
    expect(getMastery(db, "category:grammar")).toBeCloseTo(0.5, 10);
    expect(recordCompletion(db, "category:grammar", 1)).toBeCloseTo(0.75, 10);
    // a different pattern is tracked independently
    expect(getMastery(db, "category:idiom")).toBe(0);
    db.close();
  });

  it("survives a reopen (a reload sees the stored mastery)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-mastery-reload-"));
    dirs.push(dir);
    const dbPath = path.join(dir, "erika.db");
    const db1 = openDatabase(dbPath);
    recordCompletion(db1, "category:vocabulary", 0.6);
    db1.close();
    const db2 = openDatabase(dbPath);
    expect(getMastery(db2, "category:vocabulary")).toBeCloseTo(0.3, 10);
    db2.close();
  });
});
