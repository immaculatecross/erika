import { DEFAULT_REGISTER as REGISTER_DEFAULT } from "../register";
import { gradeSpokenAnswer } from "./spoken-answer";

// ─────────────────────────────────────────────────────────────────────────────
// THE ONE LESSON FORMAT (E-45 criterion 1) and THE ONE EXERCISE VOCABULARY
// (criterion 2). Client-safe: the server generator imports node:crypto and
// better-sqlite3 at module load, so the shapes and the deterministic grading live
// here, where both the browser runner and the server can use them.
//
// What this replaces. There were two disjoint lesson systems and four exercise
// kinds: pattern lessons did `multiple_choice`, a TYPED `fill_in`, and a `rewrite`
// GRADED BY A BILLED MODEL CALL; item lessons did `multiple_choice` and a TYPED
// `cloze`. Two runners, two vocabularies, one learner — *"the keyword here is
// simplify."*
//
// There is now ONE exercise, and the simplification is sharper than merging two
// lists. A drill is a cue, a set of options, and one correct answer. `invite` says
// how the learner is asked to answer FIRST — tap an option, or say it aloud — and
// that is a presentation choice, not a second kind of exercise:
//
//   * every drill carries `options`, so a spoken drill ALWAYS has a working click
//     path. That is what makes voice safe to offer: no microphone, no API key, a
//     denied permission, a bad transcript three times running — every one of those
//     falls back to tapping instead of ending at a wall (D-26: no route may end at
//     a wall);
//   * there is exactly ONE answer key and ONE grading function, so a spoken answer
//     and a tapped answer cannot disagree about what is correct;
//   * typing is gone. Not hidden — gone. There is no field to type into.
//
// D-18 is unchanged and is why `options` needs a rule of its own: the cue is
// meaning-first and the retrieval target is always the CORRECT form. Distractors
// are ordinary wrong Italian, never the learner's own recorded error.
// ─────────────────────────────────────────────────────────────────────────────

/** The two lesson kinds, keyed to a knowledge item's kind. */
export const ITEM_LESSON_KINDS = ["grammar", "vocab"] as const;
export type ItemLessonKind = (typeof ITEM_LESSON_KINDS)[number];

/**
 * How the learner is invited to answer. BOTH are always possible on every drill —
 * this only decides which is offered first, so the vocabulary is one exercise with
 * two front doors, not two exercises (D-26: subtraction wins ties).
 */
export const DRILL_INVITES = ["click", "speak"] as const;
export type DrillInvite = (typeof DRILL_INVITES)[number];

/** Kept as the name the parser and the stored bodies use. One member, because
 *  there is one exercise; it stays an array so a future kind cannot be added
 *  without touching the parser, the runner and the budget together. */
export const ITEM_EXERCISE_TYPES = ["choice"] as const;
export type ItemExerciseType = (typeof ITEM_EXERCISE_TYPES)[number];

export interface ItemExercise {
  type: ItemExerciseType;
  /** The meaning-first cue: an English instruction/gloss, or an Italian sentence
   *  with a gap written `____`. NEVER an error form (D-18). */
  prompt: string;
  /** An English gloss fronting the cue when the target is not inferable from the
   *  Italian alone — D-18 explicitly permits an English-gloss front. */
  gloss?: string;
  /** The options shown. ALWAYS present and always ≥2, including on a spoken drill:
   *  this is the click fallback that keeps voice from ever becoming a dead end. */
  options: string[];
  /** 0-based index of the correct option. `options[answerIndex] === answer`. */
  answerIndex: number;
  /** The correct retrieval target — always the CORRECT form (D-18). */
  answer: string;
  /** How the learner is asked to answer first. */
  invite: DrillInvite;
  /** Why the answer is correct — correction-forward feedback (D-18). */
  rationale: string;
}

/** One word a vocabulary lesson teaches: the Italian, and what it means. */
export interface LessonWord {
  lemma: string;
  /** English gloss. A vocabulary lesson without one teaches nothing. */
  gloss: string;
  /** One correct Italian sentence using it, at the D-23 register. */
  example?: string;
}

export interface ItemLesson {
  itemId: string;
  kind: ItemLessonKind;
  /** The register the lesson was written in (D-23) — "colto" by default. */
  register: string;
  /** The teaching text, in plain English. Bounded by MAX_INTRO_WORDS. */
  intro: string;
  /** Worked Italian examples at the register — "three or four", per the operator. */
  examples: string[];
  /** The words a vocabulary lesson teaches — "about ten", per the operator. */
  newWords: LessonWord[];
  /** Vocab only: the headline lemma's English gloss. NULL for grammar lessons. */
  glossEn: string | null;
  exercises: ItemExercise[];
  /** True when this lesson was built from the syllabus with NO model call — the
   *  keyless path (D-27), and the reason an empty database still gets a lesson. */
  deterministic?: boolean;
}

/** A lesson body ready to persist (no created_at yet) — the parsed model output. */
export type NewItemLesson = ItemLesson;

/** The default register for a generated lesson (D-23, default colto). */
export const DEFAULT_REGISTER: string = REGISTER_DEFAULT;

export function defaultRegister(): string {
  return DEFAULT_REGISTER;
}

/**
 * Whether an exercise is well-formed enough to put in front of a learner.
 *
 * This is the drill-side twin of `frontIsAnswerable` in lib/cards-view.ts, and it
 * exists for the same reason: a drill nobody can answer is worse than no drill.
 * Every rule is structural, so a legacy stored body (a typed `cloze` with no
 * options) fails them and is dropped on read rather than rendered as a broken
 * control — which is what lets the format change without a migration.
 */
export function drillIsUsable(ex: ItemExercise): boolean {
  if (!ex?.prompt?.trim() || !ex?.answer?.trim() || !ex?.rationale?.trim()) return false;
  if (!Array.isArray(ex.options) || ex.options.length < 2) return false;
  if (!Number.isInteger(ex.answerIndex) || ex.answerIndex < 0 || ex.answerIndex >= ex.options.length) return false;
  if (ex.options[ex.answerIndex] !== ex.answer) return false;
  // Distinct options: two identical choices make one of them unanswerable.
  return new Set(ex.options.map((o) => o.trim().toLowerCase())).size === ex.options.length;
}

/** Drop every stored exercise the current format cannot render — a legacy body, or
 *  a model reply that produced fewer good drills than it promised. */
export function usableDrills(exercises: readonly ItemExercise[]): ItemExercise[] {
  return (exercises ?? []).filter(drillIsUsable);
}

/**
 * Grade one drill. DETERMINISTIC and never a model call — a tapped index compares
 * by index; a spoken answer compares by normalized string against the same answer
 * key (lib/lessons/spoken-answer.ts carries the normalization rules and the
 * deliberate refusal to do fuzzy matching).
 *
 * `response` is the picked index (click) or the transcript (speak).
 */
export function gradeItemExercise(ex: ItemExercise, response: number | string): boolean {
  if (typeof response === "number") return response === ex.answerIndex;
  return gradeSpokenAnswer(ex.answer, response);
}

/** The completion score (0..1): fraction of exercises answered correctly. */
export function itemLessonScore(correctCount: number, total: number): number {
  return total <= 0 ? 0 : correctCount / total;
}
