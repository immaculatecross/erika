import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { monthKey, monthToDateSpend, recordSpend, wouldExceedBudget } from "@/lib/analysis/budget";

// Criterion 7 — the spend ledger: N billable calls make N rows summing to the
// month-to-date total. Criterion 6 (cap logic, unit half) — wouldExceedBudget is
// a hard, truthful gate: equal-to-budget is allowed, a cent over is not.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-budget-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("spend ledger", () => {
  it("records one row per billable call and sums the month to date", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 0.01 });
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "a", costUsd: 0.2 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "b", costUsd: 0.01 });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
    expect(rows.n).toBe(3);
    expect(monthToDateSpend(db)).toBeCloseTo(0.22, 10);
    db.close();
  });

  it("buckets spend by calendar month and ignores other months", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 1 }, new Date("2026-05-10T00:00:00Z"));
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "b", costUsd: 2 }, new Date("2026-06-10T00:00:00Z"));
    expect(monthToDateSpend(db, "2026-05")).toBe(1);
    expect(monthToDateSpend(db, "2026-06")).toBe(2);
    expect(monthKey(new Date("2026-06-10T00:00:00Z"))).toBe("2026-06");
    db.close();
  });

  it("gates hard: allows reaching the cap, refuses exceeding it", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 9.9 });
    expect(wouldExceedBudget(db, 0.1, 10)).toBe(false); // 9.9 + 0.1 == 10, allowed
    expect(wouldExceedBudget(db, 0.11, 10)).toBe(true); // 10.01 > 10, refused
    db.close();
  });
});
