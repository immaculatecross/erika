import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { getLessonByPattern, insertLesson } from "@/lib/lessons/lessons";

// Migration v7 — the lessons/mastery tables exist, a lesson round-trips its typed
// exercises through the JSON column, and `pattern_key` is UNIQUE so a pattern
// keeps exactly one lesson (the cache invariant behind WO criterion 4).

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-lessons-schema-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("migration v7 schema", () => {
  it("creates the lessons and lesson_mastery tables", () => {
    const db = freshDb();
    const tables = new Set(
      (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name),
    );
    expect(tables.has("lessons")).toBe(true);
    expect(tables.has("lesson_mastery")).toBe(true);
    db.close();
  });

  it("round-trips a lesson's typed exercises and enforces one lesson per pattern", () => {
    const db = freshDb();
    const lesson = insertLesson(db, "category:grammar", {
      explanation: "e",
      exercises: [
        { type: "multiple_choice", prompt: "p", options: ["a", "b"], answerIndex: 1 },
        { type: "rewrite", prompt: "r", target: "t" },
      ],
    });
    expect(lesson.exercises).toHaveLength(2);
    const fetched = getLessonByPattern(db, "category:grammar");
    expect(fetched?.exercises[0]).toEqual({ type: "multiple_choice", prompt: "p", options: ["a", "b"], answerIndex: 1 });

    // The UNIQUE pattern_key rejects a second lesson for the same pattern.
    expect(() => insertLesson(db, "category:grammar", { explanation: "e2", exercises: [{ type: "fill_in", prompt: "p", answer: "a" }] })).toThrow();
    db.close();
  });
});
