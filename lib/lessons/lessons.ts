import { randomUUID } from "node:crypto";
import type { Db } from "../db";

// Typed data layer for generated micro-lessons (E-6), in the lib/cards.ts /
// lib/analysis/findings.ts style. Server-only. A lesson is one short grammar
// explanation plus a list of typed exercises, generated once per pattern and
// cached by `pattern_key` (UNIQUE) so re-opening a pattern's lesson never
// re-generates or re-bills (WO criterion 4). Exercises are stored as a JSON blob
// in the `exercises` column — a self-contained typed list, never queried
// column-wise, so JSON is the simplest faithful representation.

/** The three exercise kinds a lesson can carry (WO criterion 2). */
export type Exercise =
  | { type: "multiple_choice"; prompt: string; options: string[]; answerIndex: number }
  | { type: "fill_in"; prompt: string; answer: string }
  | { type: "rewrite"; prompt: string; target: string };

export const EXERCISE_TYPES = ["multiple_choice", "fill_in", "rewrite"] as const;

export interface Lesson {
  id: string;
  patternKey: string;
  explanation: string;
  exercises: Exercise[];
  createdAt: string;
}

/** A validated lesson body ready to persist (no id/timestamp yet). */
export interface NewLesson {
  explanation: string;
  exercises: Exercise[];
}

interface LessonRow {
  id: string;
  pattern_key: string;
  explanation: string;
  exercises: string;
  created_at: string;
}

function toLesson(r: LessonRow): Lesson {
  return {
    id: r.id,
    patternKey: r.pattern_key,
    explanation: r.explanation,
    // Exercises were validated on the way in (parseLessonResponse); trust the row.
    exercises: JSON.parse(r.exercises) as Exercise[],
    createdAt: r.created_at,
  };
}

/** The cached lesson for a pattern, or null if none has been generated yet. */
export function getLessonByPattern(db: Db, patternKey: string): Lesson | null {
  const r = db.prepare("SELECT * FROM lessons WHERE pattern_key = ?").get(patternKey) as LessonRow | undefined;
  return r ? toLesson(r) : null;
}

/**
 * Insert a generated lesson for a pattern and return it. `run` may pass a
 * transaction so the insert commits atomically with its spend-ledger row — a
 * lesson is never persisted without its charge recorded, and vice versa. The
 * UNIQUE `pattern_key` makes a concurrent double-generate a truthful failure
 * rather than a silent duplicate.
 */
export function insertLesson(db: Db, patternKey: string, lesson: NewLesson): Lesson {
  const id = randomUUID();
  db.prepare("INSERT INTO lessons (id, pattern_key, explanation, exercises) VALUES (?, ?, ?, ?)").run(
    id,
    patternKey,
    lesson.explanation,
    JSON.stringify(lesson.exercises),
  );
  return getLessonByPattern(db, patternKey)!;
}
