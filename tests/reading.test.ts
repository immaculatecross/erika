import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { loadCanon, getPassage, cefrRank, type CanonPassage } from "@/lib/canon";
import { selectPassage, learnerReadingEdge, buildReadingView } from "@/lib/reading";
import { ensureRuleItem } from "@/lib/knowledge/items";
import { recordEvidence } from "@/lib/knowledge/evidence";
import type { CefrLevel } from "@/lib/syllabus/types";

// E-33 criterion 3: reading/listening from the canon at the learner's edge. The
// passage asset is public-domain and attributed (D-19); selection respects the edge
// (a beginner gets an easier passage than an advanced learner); the edge is derived
// from the knowledge state. Selection is a pure function tested with hand-built
// inputs; the derivation is tested against a real DB.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-reading-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function passage(id: string, cefr: CefrLevel): CanonPassage {
  return { id, author: "a", work: "w", year: 1800, cefr, text: `text ${id}`, source: "public domain" };
}

describe("the canon asset (D-19 license discipline)", () => {
  it("loads, is license 'public-domain', and every passage is attributed and leveled", () => {
    const canon = loadCanon();
    expect(canon.license).toBe("public-domain");
    expect(canon.passages.length).toBeGreaterThan(0);
    for (const p of canon.passages) {
      expect(p.author.length).toBeGreaterThan(0);
      expect(p.work.length).toBeGreaterThan(0);
      expect(p.text.trim().length).toBeGreaterThan(0);
      expect(p.source.toLowerCase()).toContain("public domain");
      expect(cefrRank(p.cefr)).toBeGreaterThanOrEqual(0);
    }
  });

  it("a committed NOTICE records provenance for the license claim", () => {
    const notice = fs.readFileSync(path.join(process.cwd(), "lib", "canon", "NOTICE.md"), "utf8");
    expect(notice.toLowerCase()).toContain("public domain");
    // Every passage's author is named in the NOTICE table.
    for (const p of loadCanon().passages) expect(notice).toContain(p.author);
  });

  it("getPassage resolves a real id and null otherwise", () => {
    const first = loadCanon().passages[0];
    expect(getPassage(first.id)?.id).toBe(first.id);
    expect(getPassage("nope")).toBeNull();
  });
});

describe("selectPassage — matched to the edge", () => {
  const passages = [passage("a1", "A1"), passage("b1", "B1"), passage("c1", "C1")];

  it("a beginner gets a strictly easier passage than an advanced learner", () => {
    const beginner = selectPassage(passages, "A1")!;
    const advanced = selectPassage(passages, "C1")!;
    expect(cefrRank(beginner.cefr)).toBeLessThan(cefrRank(advanced.cefr));
    expect(beginner.cefr).toBe("A1");
    expect(advanced.cefr).toBe("C1");
  });

  it("picks the highest band at or below the edge (never above it)", () => {
    // Edge B2, no B2 passage → the B1 is the highest ≤ edge, never the C1.
    expect(selectPassage(passages, "B2")!.cefr).toBe("B1");
  });

  it("falls back to the easiest when every passage is above the edge", () => {
    expect(selectPassage([passage("b1", "B1"), passage("c1", "C1")], "A1")!.cefr).toBe("B1");
  });

  it("returns null for an empty canon", () => {
    expect(selectPassage([], "A1")).toBeNull();
  });
});

describe("learnerReadingEdge — derived from knowledge state", () => {
  it("defaults to A1 with no engaged items, and rises to the highest engaged band", () => {
    const db = freshDb();
    expect(learnerReadingEdge(db)).toBe("A1");

    // Engage a B2 rule (two correct events on two days → learning/known). Evidence
    // moves status off 'unseen', so its band counts toward the edge.
    ensureRuleItem(db, "congiuntivo", { cefr: "B2" });
    recordEvidence(db, { itemId: "rule:congiuntivo", source: "exercise", polarity: 1, mode: "cued", audioDerived: false });
    expect(learnerReadingEdge(db)).toBe("B2");

    // The reading view picks a passage at or below B2.
    const view = buildReadingView(db);
    expect(view.edge).toBe("B2");
    expect(view.passage).not.toBeNull();
    expect(cefrRank(view.passage!.cefr)).toBeLessThanOrEqual(cefrRank("B2"));
    db.close();
  });
});
