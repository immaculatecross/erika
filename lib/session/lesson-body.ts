import type { ItemLesson } from "../lessons/item-lessons-view";
import type { NoticeReason } from "./notices";

// The wire shape of `POST /api/session/lesson` (E-44). Client-safe by construction —
// types only, no DB, no server imports — so the runner components can name it without
// dragging a server module into the browser bundle.

/** The model-free lesson content E-26 authored for every one of the 266 syllabus
 *  rules. This is what the lesson step degrades TO — not a placeholder, a lesson. */
export interface LessonFallback {
  title: string;
  description: string;
  examples: string[];
  cefr: string;
}

export interface SessionLessonBody {
  itemId: string;
  kind: "grammar" | "vocab";
  label: string | null;
  /** The generated lesson (intro + exercises), or null when it could not be written. */
  lesson: ItemLesson | null;
  /** The syllabus's own authored content — always present for a rule, null for a lemma
   *  (the frequency lexicon carries no glosses: D-19 keeps the CC BY-NC glossaries out
   *  of the shipped data path). */
  fallback: LessonFallback | null;
  /** Why `lesson` is null. Null when the lesson is there. */
  notice: NoticeReason | null;
}
