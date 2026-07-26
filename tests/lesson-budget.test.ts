import { describe, expect, it } from "vitest";
import {
  LESSON_MAX_MINUTES,
  MAX_DRILLS,
  MAX_EXAMPLES,
  MAX_INTRO_WORDS,
  MAX_NEW_WORDS,
  MIN_DRILLS,
  READING_WPM,
  SECONDS_PER_DRILL,
  SECONDS_PER_EXAMPLE,
  SECONDS_PER_NEW_WORD,
  budgetInstruction,
  drillWords,
  lessonFitsBudget,
  lessonMinutes,
  trimToBudget,
  trimWords,
} from "@/lib/lessons/lesson-budget";
import type { ItemExercise, ItemLesson } from "@/lib/lessons/item-lessons-view";

// E-45 criterion 1 — THE FIVE-MINUTE PROMISE, AS ARITHMETIC.
//
// "Five minutes" is only a constraint if something can be over it. These tests
// drive the worst case the caps permit and assert it still fits, then drive a
// deliberately oversized lesson and assert it is TRIMMED rather than rejected —
// the learner is not the one who wrote it, and they may already have paid for it.

function drill(words = 10): ItemExercise {
  const filler = Array.from({ length: words }, () => "parola").join(" ");
  return {
    type: "choice",
    prompt: filler,
    options: ["a", "b"],
    answerIndex: 0,
    answer: "a",
    invite: "click",
    rationale: "r",
  };
}

function lesson(over: Partial<ItemLesson> = {}): ItemLesson {
  return {
    itemId: "rule:x",
    kind: "grammar",
    register: "colto",
    intro: "Short.",
    examples: [],
    newWords: [],
    definition: null,
    exercises: [drill(), drill()],
    ...over,
  };
}

describe("lessonMinutes — every part of a lesson has a stated time cost", () => {
  it("prices the teaching text at the stated reading speed", () => {
    const words = Array.from({ length: READING_WPM }, () => "word").join(" ");
    // Exactly one minute of reading, plus nothing else.
    expect(lessonMinutes({ intro: words, examples: [], newWords: [], exercises: [] })).toBeCloseTo(1, 5);
  });

  it("prices examples, new words and drills at their own per-item seconds", () => {
    const base = { intro: "", examples: [], newWords: [], exercises: [] };
    expect(lessonMinutes({ ...base, examples: ["a", "b"] })).toBeCloseTo((2 * SECONDS_PER_EXAMPLE) / 60, 5);
    expect(lessonMinutes({ ...base, newWords: [{ lemma: "a", definition: "b" }] })).toBeCloseTo(SECONDS_PER_NEW_WORD / 60, 5);
    expect(lessonMinutes({ ...base, exercises: [drill(), drill(), drill()] })).toBeCloseTo((3 * SECONDS_PER_DRILL) / 60, 5);
  });

  it("counts a drill's whole footprint — cue, definition, options and reason", () => {
    const d: ItemExercise = { ...drill(0), prompt: "one two", definition: "three", options: ["four", "five"], rationale: "six" };
    expect(drillWords(d)).toBe(6);
  });
});

describe("the caps are chosen so the WORST case still fits the promise", () => {
  it("a lesson at every cap simultaneously is inside five minutes", () => {
    // The genuinely worst lesson the caps permit: max intro, max examples, max new
    // words, max drills. If this is over, the caps are a decoration.
    const worst = lesson({
      intro: Array.from({ length: MAX_INTRO_WORDS }, () => "word").join(" "),
      examples: Array.from({ length: MAX_EXAMPLES }, (_, i) => `e${i}`),
      newWords: Array.from({ length: MAX_NEW_WORDS }, (_, i) => ({ lemma: `l${i}`, definition: "g" })),
      exercises: Array.from({ length: MAX_DRILLS }, () => drill()),
    });
    expect(lessonMinutes(worst)).toBeLessThanOrEqual(LESSON_MAX_MINUTES);
    expect(lessonFitsBudget(worst)).toBe(true);
  });

  it("and something CAN be over it — otherwise this is not a constraint", () => {
    const oversized = lesson({ exercises: Array.from({ length: 40 }, () => drill()) });
    expect(lessonFitsBudget(oversized)).toBe(false);
  });
});

describe("trimToBudget — subtraction, in an order that protects the teaching", () => {
  it("brings an oversized lesson inside the promise", () => {
    const trimmed = trimToBudget(
      lesson({
        intro: Array.from({ length: MAX_INTRO_WORDS * 4 }, () => "word").join(" "),
        examples: Array.from({ length: 20 }, (_, i) => `e${i}`),
        newWords: Array.from({ length: 30 }, (_, i) => ({ lemma: `l${i}`, definition: "g" })),
        exercises: Array.from({ length: 30 }, () => drill()),
      }),
    );
    // Expectations come from the CAPS, never from what trimToBudget returned.
    expect(trimmed.intro.split(/\s+/).length).toBeLessThanOrEqual(MAX_INTRO_WORDS);
    expect(trimmed.examples).toHaveLength(MAX_EXAMPLES);
    expect(trimmed.newWords).toHaveLength(MAX_NEW_WORDS);
    expect(trimmed.exercises.length).toBeLessThanOrEqual(MAX_DRILLS);
    expect(lessonFitsBudget(trimmed)).toBe(true);
    // THE POSITIVE: a real lesson survives the trim. Trimming to nothing would
    // satisfy "fits the budget" and fail the learner.
    expect(trimmed.exercises.length).toBeGreaterThanOrEqual(MIN_DRILLS);
    expect(trimmed.intro.length).toBeGreaterThan(0);
  });

  it("never trims below the drill floor, even if that leaves the lesson at the limit", () => {
    // A pathological lesson whose drills alone exceed five minutes: it is cut to
    // the floor and no further, because a lesson with no drill is a different
    // thing, not a shorter one.
    const trimmed = trimToBudget(lesson({ exercises: Array.from({ length: 99 }, () => drill()) }));
    expect(trimmed.exercises.length).toBeGreaterThanOrEqual(MIN_DRILLS);
  });

  it("leaves a lesson that already fits completely alone", () => {
    const fine = lesson({ intro: "Two sentences. That is all.", examples: ["a"] });
    expect(trimToBudget(fine)).toEqual(fine);
  });

  it("trims prose at a sentence boundary rather than mid-clause", () => {
    expect(trimWords("One two. Three four five six.", 4)).toBe("One two.");
    expect(trimWords("Short enough.", 10)).toBe("Short enough.");
    // No boundary to find: an ellipsis says the text was cut, rather than pretending.
    expect(trimWords("aaa bbb ccc ddd", 2)).toBe("aaa bbb…");
  });
});

describe("the model is TOLD the budget", () => {
  it("states every cap as a number, so the reply can obey it rather than be trimmed", () => {
    const text = budgetInstruction();
    expect(text).toContain(`under ${LESSON_MAX_MINUTES} minutes`);
    expect(text).toContain(`${MAX_INTRO_WORDS} words`);
    expect(text).toContain(`${MAX_EXAMPLES} worked examples`);
    expect(text).toContain(`${MIN_DRILLS}-${MAX_DRILLS} exercises`);
  });
});
