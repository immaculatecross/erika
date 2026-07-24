import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { buildKnowledgeMap, buildMapCells, masteryBand, MASTERY_BANDS } from "@/lib/knowledge-map";
import { resolvedSlipCount, computeSlipStandings } from "@/lib/slips";
import { CATEGORY_ORDER } from "@/lib/analysis-view";

// E-38 criterion 3 (D-24 / DESIGN.md:47). The map strip tints toward green ONLY
// through resolved-slip semantics. The rule this file exists to protect: ACTIVITY IS
// NOT MASTERY. A category the learner has slipped in constantly — and practised
// constantly — stays neutral until those slips are actually resolved.

describe("masteryBand — a cell greens only on RESOLVED slips", () => {
  it("is 0 whenever nothing is resolved, however many slips there are", () => {
    expect(masteryBand(0, 0)).toBe(0);
    expect(masteryBand(0, 1)).toBe(0);
    expect(masteryBand(0, 250)).toBe(0);
  });

  it("rises with the resolved SHARE and tops out at full green", () => {
    expect(masteryBand(1, 100)).toBe(1); // one resolved out of many: the faintest tint
    expect(masteryBand(1, 2)).toBe(2);
    expect(masteryBand(3, 4)).toBe(3);
    expect(masteryBand(4, 4)).toBe(MASTERY_BANDS);
  });
});

describe("buildMapCells — one cell per category, in CATEGORY_ORDER", () => {
  it("reports a stable strip even with no slips at all, and greens nothing", () => {
    const cells = buildMapCells([]);
    expect(cells.map((c) => c.category)).toEqual([...CATEGORY_ORDER]);
    expect(cells.every((c) => c.band === 0 && c.slips === 0 && c.resolved === 0)).toBe(true);
  });

  it("a category with heavy ACTIVITY but zero resolved slips does NOT tint green", () => {
    const cells = buildMapCells([
      ...Array.from({ length: 12 }, () => ({ category: "grammar" as const, state: "active" })),
      ...Array.from({ length: 4 }, () => ({ category: "grammar" as const, state: "remission" })),
      { category: "phrasing" as const, state: "resolved" },
    ]);
    const grammar = cells.find((c) => c.category === "grammar")!;
    expect(grammar.slips).toBe(16); // plenty going on
    expect(grammar.resolved).toBe(0);
    expect(grammar.mastery).toBe(0);
    expect(grammar.band).toBe(0); // ← and still no green
    // Remission is NOT resolved: green on the map means mastered, not "quiet lately".
    expect(cells.find((c) => c.category === "phrasing")!.band).toBeGreaterThan(0);
  });

  it("ignores a standing whose category is not one of the five", () => {
    const cells = buildMapCells([{ category: "nonsense" as never, state: "resolved" }]);
    expect(cells.every((c) => c.slips === 0)).toBe(true);
  });
});

describe("buildKnowledgeMap — the data path, over the SHARED slip standing", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-map-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  /** An analysed session at `createdAt` carrying `findings`. */
  function analysedSession(
    db: Db,
    id: string,
    createdAt: string,
    findings: { correction: string; category: "grammar" | "vocabulary" }[],
  ): void {
    createSession(db, { id, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 600 });
    db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(createdAt, id);
    upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 600_000, contentHash: `${id}-h` });
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: `${id}-h`,
      flagged: true,
      deepDone: true,
      findings: findings.map((f, i) => ({
        quote: `q${i}`,
        correction: f.correction,
        category: f.category,
        explanation: "e",
        severity: "low" as const,
        startMs: i * 1000,
        endMs: i * 1000 + 500,
      })),
    });
    const job = enqueueAnalysis(db, id);
    db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
  }

  it("stays neutral for a category that slips over and over and resolves nothing", () => {
    const db = freshDb();
    // The same grammar mistake in every session, right up to the latest ⇒ active.
    for (let i = 1; i <= 5; i++) {
      analysedSession(db, `s${i}`, `2026-07-0${i} 10:00:00`, [
        { correction: "un problema", category: "grammar" },
      ]);
    }
    const cells = buildKnowledgeMap(db);
    const grammar = cells.find((c) => c.category === "grammar")!;
    expect(grammar.slips).toBe(1);
    expect(grammar.resolved).toBe(0);
    expect(grammar.band).toBe(0);
    expect(cells.map((c) => c.category)).toEqual([...CATEGORY_ORDER]);
    db.close();
  });

  it("reduces exactly the same standings Focus's green count reduces (one notion)", () => {
    const db = freshDb();
    analysedSession(db, "s1", "2026-07-01 10:00:00", [{ correction: "un problema", category: "grammar" }]);
    for (let i = 2; i <= 5; i++) analysedSession(db, `s${i}`, `2026-07-0${i} 10:00:00`, []);

    const cells = buildKnowledgeMap(db);
    const totalResolved = cells.reduce((n, c) => n + c.resolved, 0);
    expect(totalResolved).toBe(resolvedSlipCount(db));
    expect(cells.reduce((n, c) => n + c.slips, 0)).toBe(computeSlipStandings(db).length);
    db.close();
  });
});
