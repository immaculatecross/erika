import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { compose } from "@/lib/compose";
import { seedPlacement } from "@/lib/knowledge/seed-placement";
import { getItem, deriveStatus, recordEvidence, itemEvidence } from "@/lib/knowledge";
import type { Evidence } from "@/lib/knowledge";

// Placement seeding (E-35, D-19). The one hard rule: recognition-only evidence
// NEVER mints `known`, and the RETRO-003 fix — a placed learner is not handed an A1
// alphabet lesson — must hold end to end through the real composer. A real seeded DB
// (v17 lexicon + v18 syllabus) per test.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-placement-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A real lemma item id that exists in the seeded inventory. */
function someLemmaId(db: Db, offset = 0): string {
  return (
    db.prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT 1 OFFSET ?").get(offset) as {
      id: string;
    }
  ).id;
}
/** Map rule ids in a plan to their CEFR band. */
function ruleCefr(db: Db, ids: string[]): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const id of ids) {
    const r = db.prepare("SELECT cefr FROM knowledge_items WHERE id = ?").get(id) as { cefr: string | null } | undefined;
    m.set(id, r?.cefr ?? null);
  }
  return m;
}
const WIDE = { newVocab: 20, newRules: 500, newPron: 0, dailyMax: 5000 };

describe("seedPlacement — recognition-only evidence never mints known (criterion 2)", () => {
  it("a recognized real word reaches introduced, NEVER known", () => {
    const db = freshDb();
    const id = someLemmaId(db);
    const res = seedPlacement(db, { level: null, recognizedItemIds: [id] });
    expect(res.seededWords).toBe(1);
    expect(getItem(db, id)!.status).toBe("introduced");
    expect(getItem(db, id)!.status).not.toBe("known");
    db.close();
  });

  it("seeded sub-level grammar rules reach introduced, none reach known", () => {
    const db = freshDb();
    const res = seedPlacement(db, { level: "B1", recognizedItemIds: [] });
    expect(res.seededRules).toBeGreaterThan(0);
    // Every rule at/below B1 is now introduced; no rule anywhere is known.
    const rules = db.prepare("SELECT id, cefr, status FROM knowledge_items WHERE kind='rule'").all() as {
      id: string;
      cefr: string | null;
      status: string;
    }[];
    const a1 = rules.filter((r) => r.cefr === "A1");
    expect(a1.length).toBeGreaterThan(0);
    expect(a1.every((r) => r.status === "introduced")).toBe(true);
    expect(rules.every((r) => r.status !== "known")).toBe(true);
    db.close();
  });

  it("derive.ts forbids recognition-only known even across many days (D-19, RETRO-002 P3)", () => {
    const db = freshDb();
    const id = someLemmaId(db);
    // Five recognition positives on five distinct days: still only 'introduced'.
    const rows: Evidence[] = [];
    for (let d = 1; d <= 5; d++) {
      rows.push({
        id: `ev${d}`,
        itemId: id,
        source: "placement",
        sourceRef: null,
        polarity: 1,
        mode: "recognition",
        weight: 0.3,
        sessionId: null,
        createdAt: `2026-07-0${d} 10:00:00`,
      });
    }
    expect(deriveStatus(rows)).toBe("introduced");
    expect(deriveStatus(rows)).not.toBe("known");
    db.close();
  });

  it("is idempotent per item on re-run — the append-only log does not grow", () => {
    const db = freshDb();
    const id = someLemmaId(db);
    seedPlacement(db, { level: "A2", recognizedItemIds: [id] });
    const after1 = itemEvidence(db, id).length;
    const res2 = seedPlacement(db, { level: "A2", recognizedItemIds: [id] });
    expect(res2.seededWords).toBe(0); // already placement-seeded → skipped
    expect(itemEvidence(db, id).length).toBe(after1);
    db.close();
  });
});

describe("post-placement composer — the RETRO-003 fix, end to end (criterion 2)", () => {
  it("a learner placed at B1 is NOT handed an A1 grammar lesson", () => {
    const db = freshDb();

    // BEFORE placement: the composer offers A1 rules (the defect — everyone gets A1).
    const before = compose(db, "2026-07-24", WIDE).items.filter((i) => i.kind === "rule").map((i) => i.ref);
    const beforeCefr = ruleCefr(db, before);
    expect(before.length).toBeGreaterThan(0);
    expect([...beforeCefr.values()].filter((c) => c === "A1").length).toBeGreaterThan(0);
    // The canonical "A1 alphabet lesson" is among them.
    expect(before).toContain("rule:alfabeto-suoni");

    // Place the learner at B1.
    seedPlacement(db, { level: "B1", recognizedItemIds: [] });

    // AFTER: the composer still offers grammar (Finding #1 — a placed learner must
    // NOT be handed zero rules), but at the learner's EDGE, not the basics: no A1,
    // and ≥1 rule at B1/B2. Recognition-`introduced` sub-level prereqs now satisfy
    // teaching-eligibility (TEACH_ELIGIBLE_PREREQ), unlocking the rules at the level.
    const after = compose(db, "2026-07-25", WIDE).items.filter((i) => i.kind === "rule").map((i) => i.ref);
    const afterCefr = ruleCefr(db, after);
    expect(after.length).toBeGreaterThan(0); // NOT zero — fails under the pre-fix behavior
    expect([...afterCefr.values()].filter((c) => c === "A1")).toEqual([]); // no basics
    expect(after).not.toContain("rule:alfabeto-suoni");
    // At least one offered rule sits at the learner's edge (B1) or just above (B2).
    expect([...afterCefr.values()].filter((c) => c === "B1" || c === "B2").length).toBeGreaterThan(0);
    db.close();
  });

  it("recognized words are excluded from new-vocab selection after placement", () => {
    const db = freshDb();
    const top = someLemmaId(db); // the single most-frequent lemma
    // Baseline: the top lemma leads new vocab.
    const beforeVocab = compose(db, "2026-07-24", WIDE).items.filter((i) => i.kind === "vocab").map((i) => i.ref);
    expect(beforeVocab).toContain(top);

    seedPlacement(db, { level: "A1", recognizedItemIds: [top] });

    const afterVocab = compose(db, "2026-07-25", WIDE).items.filter((i) => i.kind === "vocab").map((i) => i.ref);
    expect(afterVocab).not.toContain(top); // recognized → introduced → not offered as new
    db.close();
  });
});
