import { normalizeAnswer } from "./lessons-view";
import { DEFAULT_REGISTER as REGISTER_DEFAULT } from "../register";

// Client-safe view types and pure helpers for the E-32 item-lesson runner. The
// server generator (lib/lessons/item-lessons.ts) imports node:crypto and
// better-sqlite3 at module load, so the browser runner cannot import the lesson
// shapes from there — this module is their single client-safe home, plus the
// deterministic checks the runner needs (exercise grading, the completion score)
// and the [RETRO-002 P4] gloss-fallback that keeps a degraded cloze answerable.
//
// An item-lesson targets ONE composer-chosen knowledge item: a grammar rule
// (`rule:<key>`) or a lemma (`lemma:<lemma>#<POS>`). Grammar lessons carry a rule
// explanation; vocabulary lessons carry an intro (meaning + a correct colto
// example) and the lemma's English gloss. Every exercise is meaning-first — an
// English instruction/gloss or an Italian context gap — never the learner's own
// erroneous form (D-18); the retrieval target is always the CORRECT form.

/** The two lesson kinds E-32 generates, keyed to a knowledge item's kind. */
export const ITEM_LESSON_KINDS = ["grammar", "vocab"] as const;
export type ItemLessonKind = (typeof ITEM_LESSON_KINDS)[number];

/** Exercise kinds an item-lesson carries. Both grade DETERMINISTICALLY on the
 *  client (multiple choice by index, cloze by normalized string match), so
 *  completing one needs NO second billable model call — the generation call is the
 *  only money the runner spends (WO: do not fork a second money path). */
export const ITEM_EXERCISE_TYPES = ["multiple_choice", "cloze"] as const;
export type ItemExerciseType = (typeof ITEM_EXERCISE_TYPES)[number];

/** The default register for a generated lesson (D-23, default colto). The E-33
 *  register dial (lib/register.ts) is now the live source; lesson generation reads
 *  it from Settings. This default remains for the estimate path and any caller
 *  without a Settings context, and is the single shared constant (no divergence). */
export const DEFAULT_REGISTER: string = REGISTER_DEFAULT;

export function defaultRegister(): string {
  return DEFAULT_REGISTER;
}

export interface ItemExercise {
  type: ItemExerciseType;
  /** The meaning-first cue: an English instruction/gloss or an Italian context with
   *  a gap. NEVER an error form (D-18). For a cloze the gap is written `____`. */
  prompt: string;
  /** An English gloss fronting the cue when the target is not inferable from context
   *  ([RETRO-002 P4] — a register upgrade / whole-phrase rewrite). Attached by the
   *  gloss-fallback so a degraded cloze is answerable, never a bare `____` (D-18). */
  gloss?: string;
  /** multiple_choice: the options shown; the correct one is `answer`. */
  options?: string[];
  /** multiple_choice: 0-based index of the correct option in `options`. */
  answerIndex?: number;
  /** The correct retrieval target — the string a cloze expects, or the correct MC
   *  option's text. The lesson's answer key; always the CORRECT form (D-18). */
  answer: string;
  /** Whether a cloze's answer is inferable from its surrounding context. `false`
   *  (or an absent/bare context) triggers the gloss-fallback for vocab lessons. */
  derivable?: boolean;
  /** Why the answer is correct — the correction-forward feedback shown after
   *  grading (D-18: correction headlined at feedback time). */
  rationale: string;
}

export interface ItemLesson {
  itemId: string;
  kind: ItemLessonKind;
  /** The register the lesson was written in (D-23) — "colto" by default. */
  register: string;
  /** Grammar: the rule explanation. Vocab: the intro (meaning + a correct example). */
  intro: string;
  /** Vocab only: the lemma's English gloss — the gloss-fallback source (P4). NULL for
   *  grammar lessons (a rule has no single English gloss). */
  glossEn: string | null;
  exercises: ItemExercise[];
}

/** A lesson body ready to persist (no created_at yet) — the parsed model output. */
export type NewItemLesson = ItemLesson;

/** A row of GET /api/learn/items — one composer-chosen item to practise today. */
export interface LearnItemSummary {
  itemId: string;
  kind: ItemLessonKind;
  /** The headline label: a rule's title, or a lemma's word. */
  label: string;
  /** A secondary label: a rule's CEFR level, or a lemma's part of speech. */
  detail: string;
  /** True once the lesson is generated (re-opening it is a free cache hit). */
  hasLesson: boolean;
  /** Worst-case generation cost in USD; null once the lesson exists. */
  estimateUsd: number | null;
}

/** How many exercises a well-formed item-lesson must carry (WO criteria 1 & 2). */
export const MIN_ITEM_EXERCISES = 3;

/**
 * A cloze cue is DEGRADED when its answer is not inferable from the surrounding
 * context: the model flagged `derivable === false`, or the prompt is effectively a
 * bare blank (a register upgrade / whole-phrase rewrite where the gap gives no
 * lexical footing). Such a cue needs an English gloss to be answerable (P4).
 */
export function clozeIsDegraded(ex: ItemExercise): boolean {
  if (ex.type !== "cloze") return false;
  if (ex.derivable === false) return true;
  // "Bare blank": the non-blank context has fewer than two real words, so the gap
  // cannot be inferred (e.g. "____" or "In colto: ____").
  const context = ex.prompt.replace(/_{2,}/g, " ").replace(/[^\p{L}\s]/gu, " ").trim();
  const words = context.split(/\s+/).filter((w) => w.length > 1);
  return words.length < 2;
}

/**
 * [RETRO-002 P4] Attach an English gloss to any degraded cloze in a VOCAB lesson
 * that lacks one, using the lesson's `glossEn`. Pure and idempotent — a well-formed
 * cloze and a cloze that already carries a gloss are left untouched, and a lesson
 * with no `glossEn` is returned unchanged (nothing to gloss with). D-18 explicitly
 * permits an English-gloss front, so a degraded cue becomes answerable instead of an
 * unanswerable `____`.
 */
export function applyGlossFallback(lesson: NewItemLesson): NewItemLesson {
  if (lesson.kind !== "vocab" || !lesson.glossEn) return lesson;
  const gloss = lesson.glossEn;
  const exercises = lesson.exercises.map((ex) =>
    ex.type === "cloze" && !ex.gloss && clozeIsDegraded(ex) ? { ...ex, gloss } : ex,
  );
  return { ...lesson, exercises };
}

/** Grade one resolved exercise. Multiple choice by index; cloze by normalized
 *  (case/whitespace-insensitive) string match against the answer — deterministic,
 *  no model call. `response` is the picked index (MC) or typed text (cloze). */
export function gradeItemExercise(ex: ItemExercise, response: number | string): boolean {
  if (ex.type === "multiple_choice") {
    return typeof response === "number" && response === ex.answerIndex;
  }
  return typeof response === "string" && normalizeAnswer(response) === normalizeAnswer(ex.answer);
}

/** The completion score (0..1): fraction of exercises answered correctly. */
export function itemLessonScore(correctCount: number, total: number): number {
  return total <= 0 ? 0 : correctCount / total;
}
