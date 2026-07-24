import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { ensureLemmaItem, ensureRuleItem, getItem } from "@/lib/knowledge/items";
import { itemEvidence } from "@/lib/knowledge/derive";
import { MODE_WEIGHT } from "@/lib/knowledge/types";
import { recordExerciseEvidence, NoSuchItemError } from "@/lib/lessons/item-evidence";
import { loadSyllabus } from "@/lib/syllabus";

// WO criterion 4: completing a graded exercise writes exactly ONE correctly-typed
// evidence row (source=exercise, mode=cued, polarity from correctness, not
// audio-derived) through the E-25 append-only door, on a morph-it-validated lemma
// id or a valid rule id, and the item's derived state rebuilds. A wrong answer
// writes a negative-polarity row. Evidence stays append-only.

const RULE_KEY = loadSyllabus().rules[0].key;
const RULE_ITEM = `rule:${RULE_KEY}`;
const LEMMA_ITEM = "lemma:casa#NOUN";

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-item-ev-"));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, "erika.db"));
  ensureRuleItem(db, RULE_KEY);
  ensureLemmaItem(db, "casa", "NOUN");
  return db;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("completing an exercise writes one cued evidence row (criterion 4)", () => {
  for (const [name, itemId] of [
    ["rule", RULE_ITEM],
    ["lemma", LEMMA_ITEM],
  ] as const) {
    it(`${name}: a correct answer writes exactly one positive cued row and updates derived state`, () => {
      const db = freshDb();
      expect(getItem(db, itemId)!.status).toBe("unseen");

      const { evidence, status } = recordExerciseEvidence(db, { itemId, correct: true });
      expect(evidence.source).toBe("exercise");
      expect(evidence.mode).toBe("cued");
      expect(evidence.polarity).toBe(1);
      // cued, not audio-derived → the undiscounted cued weight 0.6 (D-19).
      expect(evidence.weight).toBeCloseTo(MODE_WEIGHT.cued, 12);

      const rows = itemEvidence(db, itemId);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(evidence.id);

      // Derived state rebuilt: no longer unseen, and the route's returned status agrees.
      const item = getItem(db, itemId)!;
      expect(item.status).not.toBe("unseen");
      expect(status).toBe(item.status);
      db.close();
    });
  }

  it("a wrong answer writes a negative-polarity cued row", () => {
    const db = freshDb();
    const { evidence } = recordExerciseEvidence(db, { itemId: LEMMA_ITEM, correct: false });
    expect(evidence.polarity).toBe(0);
    expect(evidence.mode).toBe("cued");
    expect(itemEvidence(db, LEMMA_ITEM)).toHaveLength(1);
    db.close();
  });

  it("is append-only: two exercises write two rows, never mutating the first", () => {
    const db = freshDb();
    const a = recordExerciseEvidence(db, { itemId: LEMMA_ITEM, correct: false });
    const b = recordExerciseEvidence(db, { itemId: LEMMA_ITEM, correct: true });
    const rows = itemEvidence(db, LEMMA_ITEM);
    expect(rows).toHaveLength(2);
    // Both original rows survive unmutated (append-only). Ordering within the same
    // second ties by id, so assert the SET, not a sequence.
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set([a.evidence.id, b.evidence.id]));
    expect(new Set(rows.map((r) => r.polarity))).toEqual(new Set([0, 1]));
    db.close();
  });

  it("refuses an exercise result on a non-existent item (never a silent drop)", () => {
    const db = freshDb();
    expect(() => recordExerciseEvidence(db, { itemId: "rule:does-not-exist", correct: true })).toThrow(NoSuchItemError);
    db.close();
  });
});
