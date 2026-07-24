import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { ensureLemmaItem } from "@/lib/knowledge/items";
import { claimItemLesson, completeItemLesson, getItemLesson } from "@/lib/lessons/item-lessons";
import type { NewItemLesson } from "@/lib/lessons/item-lessons-view";

// Migration v20 — the item_lessons cache exists, a lesson round-trips its typed body
// through the JSON column, and `item_id` is the PRIMARY KEY so an item keeps exactly
// one lesson (the cache invariant behind WO criterion 3).

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-item-lessons-schema-"));
  dirs.push(dir);
  const db = openDatabase(path.join(dir, "erika.db"));
  ensureLemmaItem(db, "casa", "NOUN");
  return db;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const LESSON: NewItemLesson = {
  itemId: "lemma:casa#NOUN",
  kind: "vocab",
  register: "colto",
  intro: "«casa» means home.",
  glossEn: "house",
  exercises: [
    { type: "multiple_choice", prompt: "home?", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", rationale: "home" },
    { type: "cloze", prompt: "Torno a ____.", answer: "casa", derivable: true, rationale: "home", gloss: "house" },
  ],
};

describe("migration v20 schema", () => {
  it("creates the item_lessons table keyed by item_id", () => {
    const db = freshDb();
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
    );
    expect(tables.has("item_lessons")).toBe(true);
    const cols = db.prepare("PRAGMA table_info(item_lessons)").all() as { name: string; pk: number }[];
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["item_id", "kind", "register", "body", "created_at"]),
    );
    expect(cols.find((c) => c.name === "item_id")?.pk).toBe(1);
    db.close();
  });

  it("round-trips a lesson's typed body and enforces one lesson per item", () => {
    const db = freshDb();
    // [T1] lease-before-call: claim the item_id row, then complete it with the body.
    expect(claimItemLesson(db, { itemId: LESSON.itemId, kind: LESSON.kind, register: LESSON.register })).toBe(true);
    const stored = completeItemLesson(db, LESSON);
    expect(stored.intro).toBe(LESSON.intro);
    expect(stored.glossEn).toBe("house");
    expect(stored.exercises).toEqual(LESSON.exercises);

    const read = getItemLesson(db, LESSON.itemId)!;
    expect(read.exercises[1]).toMatchObject({ type: "cloze", answer: "casa", gloss: "house" });

    // The PK makes a second CLAIM for the same item return false (cache once, one row).
    expect(claimItemLesson(db, { itemId: LESSON.itemId, kind: LESSON.kind, register: LESSON.register })).toBe(false);
    expect((db.prepare("SELECT COUNT(*) AS n FROM item_lessons").get() as { n: number }).n).toBe(1);
    db.close();
  });
});
