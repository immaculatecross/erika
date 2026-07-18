// Client-safe view types and pure helpers for the lesson runner (E-6b), mirroring
// the split in lib/cards-view.ts / lib/analysis-view.ts. The engine's data layer
// (lessons.ts) imports node:crypto and better-sqlite3 at module load, so the
// client runner can't import `Exercise`/`Lesson` from there. This module is the
// single client-safe home of those type shapes plus the small deterministic
// checks the runner needs (fill-in matching, the completion score). lessons.ts
// re-exports the types so the server keeps one source of truth — a client-safe
// type extraction, the only permitted engine touch (no behaviour change).

/** The three exercise kinds a lesson can carry (WO criterion 3). */
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

/** A rewrite verdict as POST /api/lessons/grade returns it (client mirror of GradeResult). */
export interface LessonGrade {
  correct: boolean;
  feedback: string;
}

/** A pattern row as GET /api/lessons/patterns returns it. */
export interface PatternSummary {
  key: string;
  category: string;
  count: number;
  hasLesson: boolean;
  mastery: number;
}

/** Collapse case and surrounding/inner whitespace so fill-in matching is forgiving. */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Fill-in check: case- and whitespace-insensitive equality against the answer.
 * (Documented tolerance per WO criterion 3 — "goes " and "Goes" both pass "goes".)
 */
export function checkFillIn(answer: string, typed: string): boolean {
  return normalizeAnswer(answer) === normalizeAnswer(typed);
}

/** The completion score (0..1): fraction of exercises answered correctly. */
export function lessonScore(correctCount: number, total: number): number {
  if (total <= 0) return 0;
  return correctCount / total;
}

/** Mastery 0..1 → an integer percentage for display (rendered tabular). */
export function masteryPercent(mastery: number): number {
  return Math.round(mastery * 100);
}
