import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { ensureLemmaItem } from "@/lib/knowledge/items";
import {
  claimItemLesson,
  completeItemLesson,
  getItemLesson,
  sweepStaleItemLessonClaims,
} from "@/lib/lessons/item-lessons";
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
  intro: "«Casa» indica l'edificio in cui una persona abita e, per estensione, il proprio ambiente familiare.",
  examples: ["Torno a casa."],
  newWords: [{ lemma: "casa", definition: "Edificio o luogo in cui si abita." }],
  definition: "Edificio o luogo in cui si abita.",
  // [E-45] ONE exercise shape, and `options` is mandatory on both invites — a
  // spoken drill's options ARE its fallback when speech recognition fails.
  exercises: [
    { type: "choice", prompt: "Scegli il luogo in cui si abita.", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", invite: "click", rationale: "Casa indica il luogo in cui si abita." },
    { type: "choice", prompt: "Torno a ____.", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", invite: "speak", rationale: "La locuzione corretta è tornare a casa.", definition: "Luogo in cui si abita." },
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
      expect.arrayContaining(["item_id", "kind", "register", "body", "content_version", "claim_token", "created_at"]),
    );
    expect(cols.find((c) => c.name === "item_id")?.pk).toBe(1);
    db.close();
  });

  it("round-trips a lesson's typed body and enforces one lesson per item", () => {
    const db = freshDb();
    // [T1] lease-before-call: claim the item_id row, then complete it with the body.
    const claimToken = claimItemLesson(db, { itemId: LESSON.itemId, kind: LESSON.kind, register: LESSON.register });
    expect(claimToken).not.toBeNull();
    const stored = completeItemLesson(db, LESSON, claimToken!);
    expect(stored).not.toBeNull();
    if (!stored) throw new Error("The owned claim was not completed.");
    expect(stored.intro).toBe(LESSON.intro);
    expect(stored.definition).toBe("Edificio o luogo in cui si abita.");
    expect(stored.exercises).toEqual(LESSON.exercises);

    const read = getItemLesson(db, LESSON.itemId)!;
    expect(read.exercises[1]).toMatchObject({ type: "choice", answer: "casa", invite: "speak", definition: "Luogo in cui si abita." });

    // The PK makes a second CLAIM for the same item return false (cache once, one row).
    expect(claimItemLesson(db, { itemId: LESSON.itemId, kind: LESSON.kind, register: LESSON.register })).toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM item_lessons").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("prevents a reclaimed claim's former owner from overwriting the winner", () => {
    const db = freshDb();
    const stale = claimItemLesson(db, {
      itemId: LESSON.itemId,
      kind: LESSON.kind,
      register: LESSON.register,
    });
    expect(stale).not.toBeNull();
    db.prepare("UPDATE item_lessons SET created_at = '2000-01-01 00:00:00' WHERE item_id = ?")
      .run(LESSON.itemId);
    expect(sweepStaleItemLessonClaims(db)).toBe(1);

    const winner = claimItemLesson(db, {
      itemId: LESSON.itemId,
      kind: LESSON.kind,
      register: LESSON.register,
    });
    expect(winner).not.toBeNull();
    const winningLesson = {
      ...LESSON,
      intro: "La lezione vincente resta nella cache anche se il vecchio proprietario termina più tardi.",
    };
    expect(completeItemLesson(db, winningLesson, winner!)).not.toBeNull();
    expect(completeItemLesson(db, LESSON, stale!)).toBeNull();
    expect(getItemLesson(db, LESSON.itemId)?.intro).toBe(winningLesson.intro);
    db.close();
  });
});
