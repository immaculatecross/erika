// ─────────────────────────────────────────────────────────────────────────────
// THE FIVE-MINUTE BUDGET (E-45 criterion 1, D-26).
//
// The operator's sentence is the specification: *"a lesson should be some very
// clear grammar lesson or conjugation or ten new vocabulary words, a mix of that —
// it shouldn't last more than five minutes to really read and process."*
//
// "Five minutes" is only a constraint if something can be over it, so this module
// turns the sentence into arithmetic: every part of a lesson has a stated time
// cost, the parts have caps, and `lessonMinutes` adds them up. A lesson that does
// not fit is TRIMMED to fit (never rejected — the learner is not the one who wrote
// it), and `lessonFitsBudget` is the invariant a test asserts on the POSITIVE side:
// a lesson exists AND it fits. "No oversized lesson" would be satisfied by no
// lesson at all, which is precisely the failure v0.6 shipped.
//
// Every constant below is a CHOICE, not a measurement of the learner, and each
// carries its reasoning. They are deliberately conservative: over-estimating how
// long a lesson takes costs a slightly shorter lesson, while under-estimating
// makes the five-minute promise a lie — and this product has already learned that
// naming the dangerous direction at the definition is what keeps a constant honest
// (lib/analysis/rates.ts).
//
// The budget is also what the token ceiling is derived from. A budget the model
// cannot express inside `max_tokens` is the same defect in a different costume:
// the reply is cut off, the parse fails, the learner is billed and gets nothing.
// So `lessonOutputTokenCeiling()` is computed from these same numbers rather than
// picked, and checked against live measurement (see its comment).
// ─────────────────────────────────────────────────────────────────────────────

import type { ItemExercise, ItemLesson } from "./item-lessons-view";

/** The promise, in minutes. Everything else exists to keep it. */
export const LESSON_MAX_MINUTES = 5;

/**
 * Silent reading speed for the English teaching text, in words per minute.
 *
 * Adult silent reading of ordinary prose runs ~200–250 wpm; instructional text
 * that has to be *understood* rather than skimmed runs slower, and this text is
 * about grammar. 170 is deliberately below the ordinary-prose range: the number
 * decides how much we are willing to write, so guessing high here would let us
 * write more and still claim five minutes.
 */
export const READING_WPM = 170;

/**
 * Seconds to read and absorb ONE worked Italian example. Not counted at
 * READING_WPM: a five-word Italian sentence a learner has to parse is not the
 * same work as five English words, and counting it as prose would let a lesson
 * carry a dozen examples "for free".
 */
export const SECONDS_PER_EXAMPLE = 6;

/**
 * Seconds for ONE new word with its gloss — see it, say it, register the meaning.
 */
export const SECONDS_PER_NEW_WORD = 6;

/**
 * Seconds for ONE drill: read the cue, decide, tap or say the answer, read the
 * feedback. Twenty is on the generous side because a spoken answer costs more
 * than a tap, and the budget must hold for the slower of the two input modes.
 */
export const SECONDS_PER_DRILL = 20;

/** Cap on the English teaching text. ~110 words ≈ 39 s at READING_WPM. */
export const MAX_INTRO_WORDS = 110;

/** Cap on worked Italian examples — the operator asked for "three or four". */
export const MAX_EXAMPLES = 4;

/** Cap on new words a vocabulary lesson may teach — the operator said "about ten". */
export const MAX_NEW_WORDS = 10;

/** Cap on drills. Five is the most that fits with a full rule explanation. */
export const MAX_DRILLS = 5;

/**
 * Floor on drills. A "lesson" you cannot answer anything in is a page, not a
 * lesson, so two is the minimum that makes the day's session real. It is a FLOOR
 * on what we ship, and `topUpDrills` is what guarantees it can always be met.
 */
export const MIN_DRILLS = 2;

/** Cap on one drill's own text (cue + options + rationale), in words. */
export const MAX_DRILL_WORDS = 60;

function words(s: string): number {
  return s.trim() === "" ? 0 : s.trim().split(/\s+/).length;
}

/** Every word a drill puts on screen — the cue, its gloss, the options, the reason. */
export function drillWords(ex: ItemExercise): number {
  return (
    words(ex.prompt) +
    words(ex.gloss ?? "") +
    ex.options.reduce((n, o) => n + words(o), 0) +
    words(ex.rationale)
  );
}

/**
 * How long this lesson takes to read and do, in minutes. The one arithmetic the
 * five-minute promise rests on; `lessonFitsBudget` is this compared to the cap.
 */
export function lessonMinutes(lesson: Pick<ItemLesson, "intro" | "examples" | "newWords" | "exercises">): number {
  const readingSeconds = (words(lesson.intro) / READING_WPM) * 60;
  const exampleSeconds = lesson.examples.length * SECONDS_PER_EXAMPLE;
  const wordSeconds = lesson.newWords.length * SECONDS_PER_NEW_WORD;
  const drillSeconds = lesson.exercises.length * SECONDS_PER_DRILL;
  return (readingSeconds + exampleSeconds + wordSeconds + drillSeconds) / 60;
}

/** The invariant: this lesson can be read and done inside the promise. */
export function lessonFitsBudget(lesson: Pick<ItemLesson, "intro" | "examples" | "newWords" | "exercises">): boolean {
  return lessonMinutes(lesson) <= LESSON_MAX_MINUTES;
}

/** Cut `text` to at most `maxWords`, preferring the last sentence boundary that fits
 *  — a lesson that stops mid-clause reads like a bug, which it would be. */
export function trimWords(text: string, maxWords: number): string {
  const parts = text.trim().split(/\s+/);
  if (parts.length <= maxWords) return text.trim();
  const cut = parts.slice(0, maxWords).join(" ");
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > 0 ? cut.slice(0, lastStop + 1) : `${cut}…`;
}

/**
 * Bring a lesson inside the budget by SUBTRACTION only — never by rewriting, which
 * would need a model and would be a second billed call to fix the first one.
 *
 * Order matters and is chosen so the teaching survives: drills go first (the
 * learner keeps the explanation), then examples down to the cap, then new words,
 * and the intro is trimmed last and at a sentence boundary. Applied to EVERY
 * lesson — generated or deterministic — so `lessonFitsBudget` is true of anything
 * this module hands out, and a model that ignores the caps in the prompt cannot
 * put an eight-minute lesson on screen.
 */
export function trimToBudget<T extends Pick<ItemLesson, "intro" | "examples" | "newWords" | "exercises">>(
  lesson: T,
): T {
  const trimmed: T = {
    ...lesson,
    intro: trimWords(lesson.intro, MAX_INTRO_WORDS),
    examples: lesson.examples.slice(0, MAX_EXAMPLES),
    newWords: lesson.newWords.slice(0, MAX_NEW_WORDS),
    exercises: lesson.exercises.slice(0, MAX_DRILLS),
  };
  // NOTE there is deliberately no "…and now drop drills until it fits" loop here.
  // The caps are chosen so that a lesson at EVERY cap simultaneously is still inside
  // the promise (110/170 min + 4x6s + 10x6s + 5x20s = 3.7 min), and
  // tests/lesson-budget.test.ts asserts exactly that — so the loop would be code no
  // input could reach, which this repo counts as a defect rather than as prudence
  // (three unkillable guards shipped in v0.6). If a cap is ever raised past the
  // promise, that test goes red, which is the signal we actually want.
  return trimmed;
}

/**
 * The budget, stated to the model. The prompt has to carry the caps or the model
 * writes whatever it likes and `trimToBudget` silently throws away work the
 * learner already paid for — and, worse, the reply gets long enough to hit the
 * token ceiling, which is how a billed call comes back empty.
 */
export function budgetInstruction(): string {
  return [
    `Keep the whole lesson under ${LESSON_MAX_MINUTES} minutes to read and do. That is a hard limit:`,
    `- the explanation is at most ${MAX_INTRO_WORDS} words;`,
    `- at most ${MAX_EXAMPLES} worked examples;`,
    `- exactly ${MIN_DRILLS}-${MAX_DRILLS} exercises, each under ${MAX_DRILL_WORDS} words including its options and reason;`,
    "- one sentence of reason per exercise, never a paragraph.",
    "Brevity is the requirement, not a preference: a longer answer is a worse answer.",
  ].join("\n");
}

/**
 * The output-token ceiling a lesson call is given, DERIVED from the budget above
 * rather than picked.
 *
 * Worst case the caps permit: MAX_INTRO_WORDS + MAX_DRILLS × MAX_DRILL_WORDS
 * = 110 + 5 × 60 = 410 words of content. English/Italian runs ~1.4 tokens per
 * word, and JSON scaffolding (keys, quotes, braces, escapes) adds roughly half
 * again, so ~410 × 1.4 × 1.5 ≈ 860 tokens. Doubling that is the ceiling.
 *
 * Checked against live measurement, not assumed: 12 real `gpt-4.1-mini` calls on
 * this repo's own prompts returned 499–770 output tokens (mean 623), all
 * `finish_reason: "stop"`. The ceiling therefore sits ~2.2× above the measured
 * worst case, and the same probe at a forced 200-token ceiling reproduced the
 * defect this exists to prevent — 6 of 6 truncated, 6 of 6 unparseable.
 *
 * The dangerous direction: a ceiling that is too LOW bills the learner for
 * nothing; one that is too HIGH only raises a reservation that is refunded down
 * to actual on every call. So it is set high on purpose.
 */
export function lessonOutputTokenCeiling(): number {
  const contentWords = MAX_INTRO_WORDS + MAX_DRILLS * MAX_DRILL_WORDS;
  return Math.ceil((contentWords * 1.4 * 1.5 * 2) / 100) * 100;
}

/**
 * The ceiling for the ONE bounded repair retry after a truncated reply (E-16's
 * pattern). Higher than the first attempt because "you ran out of room" is only
 * answerable if there is more room — and the retry also asks for the MINIMUM
 * lesson, so both levers move in the same direction.
 */
export function lessonRepairTokenCeiling(): number {
  return lessonOutputTokenCeiling() * 2;
}
