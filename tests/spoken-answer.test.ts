import { describe, expect, it } from "vitest";
import {
  MISHEARD_STREAK_TO_FALL_BACK,
  containsTokens,
  gradeSpokenAnswer,
  normalizeSpoken,
} from "@/lib/lessons/spoken-answer";
import { gradeItemExercise, type ItemExercise } from "@/lib/lessons/item-lessons-view";

// ─────────────────────────────────────────────────────────────────────────────
// E-45 criterion 2 — GRADING A SPOKEN ANSWER, DETERMINISTICALLY.
//
// Two failures are possible and they pull in opposite directions:
//
//   * marking a CORRECT learner wrong because the transcript was imperfect. This
//     is the corrosive one — this product's user is an advanced speaker with an
//     accent, and it teaches them to distrust the app and then themselves;
//   * marking a WRONG learner correct because the match was fuzzy. In Italian this
//     is not hypothetical: `gatto`/`gatta`, `parlo`/`parlò`, `fossi`/`fosse` differ
//     by one character and ARE the error under test.
//
// So the normalization is generous about transcription artifacts and the matching
// is strict about Italian. Each rule below is asserted on its own, and the refusal
// to do edit-distance matching is asserted as a REQUIREMENT rather than left as an
// absence — a fuzzy matcher added later would go red here.
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizeSpoken — the stated rules, one at a time", () => {
  it("1. lowercases", () => {
    expect(normalizeSpoken("SONO Andato")).toBe("sono andato");
  });

  it("2. folds accented vowels, so a recogniser that drops an accent is not punished", () => {
    expect(normalizeSpoken("perché")).toBe("perche");
    expect(normalizeSpoken("è")).toBe("e");
    expect(normalizeSpoken("parlò")).toBe("parlo");
  });

  it("3. treats an apostrophe as a break, so elision has one spelling", () => {
    expect(normalizeSpoken("l'amico")).toBe(normalizeSpoken("l amico"));
    expect(normalizeSpoken("c'è")).toBe(normalizeSpoken("c e"));
    expect(normalizeSpoken("dell’acqua")).toBe(normalizeSpoken("dell acqua"));
  });

  it("4. drops punctuation the speaker never uttered", () => {
    expect(normalizeSpoken("Sono andato, davvero!")).toBe("sono andato davvero");
    expect(normalizeSpoken("«casa»")).toBe("casa");
  });

  it("5. collapses whitespace and trims", () => {
    expect(normalizeSpoken("  sono   andato \n")).toBe("sono andato");
  });

  it("6. strips leading filler — hesitation is not an answer", () => {
    expect(normalizeSpoken("ehm, sono andato")).toBe("sono andato");
    expect(normalizeSpoken("allora sono andato")).toBe("sono andato");
    // …but only at the START, and only as a whole word: "ehi" is not filler.
    expect(normalizeSpoken("sono ehm andato")).toBe("sono ehm andato");
  });
});

describe("gradeSpokenAnswer — generous to the transcript, strict about Italian", () => {
  it("accepts the answer said exactly", () => {
    expect(gradeSpokenAnswer("sono", "sono")).toBe(true);
  });

  it("accepts an answer wrapped in the whole sentence — more right, not less", () => {
    // Asked to fill "vado ____ centro", learners say the whole sentence.
    expect(gradeSpokenAnswer("al", "vado al centro")).toBe(true);
    expect(gradeSpokenAnswer("sono andato", "ieri sono andato al mare")).toBe(true);
  });

  it("accepts across every normalization rule at once", () => {
    expect(gradeSpokenAnswer("perché", "Ehm, Perche!")).toBe(true);
    expect(gradeSpokenAnswer("l'amico", "l amico")).toBe(true);
  });

  it("REFUSES a one-character difference, because that is usually the error itself", () => {
    // If any of these ever pass, a fuzzy matcher has been introduced and the drill
    // has stopped testing the thing it exists to test.
    expect(gradeSpokenAnswer("gatta", "gatto")).toBe(false);
    expect(gradeSpokenAnswer("fossi", "fosse")).toBe(false);
    expect(gradeSpokenAnswer("belle", "belli")).toBe(false);
    expect(gradeSpokenAnswer("sono", "ho")).toBe(false);
  });

  it("REFUSES a partial word — containment is by whole token, never by substring", () => {
    expect(containsTokens("vado alcentro", "al")).toBe(false);
    expect(gradeSpokenAnswer("al", "vado alcentro")).toBe(false);
    // "a" must not match inside "casa".
    expect(gradeSpokenAnswer("a", "casa")).toBe(false);
    expect(gradeSpokenAnswer("a", "vado a casa")).toBe(true);
  });

  it("refuses silence", () => {
    expect(gradeSpokenAnswer("sono", "")).toBe(false);
    expect(gradeSpokenAnswer("sono", "   ")).toBe(false);
    expect(gradeSpokenAnswer("", "sono")).toBe(false);
  });
});

describe("one answer key — a spoken answer and a tapped answer cannot disagree", () => {
  const drill: ItemExercise = {
    type: "choice",
    prompt: "Ieri ____ andato al mare.",
    options: ["sono", "ho"],
    answerIndex: 0,
    answer: "sono",
    invite: "speak",
    rationale: "andare takes essere.",
  };

  it("grades the same answer the same way whichever way it arrives", () => {
    expect(gradeItemExercise(drill, drill.answerIndex)).toBe(true);
    expect(gradeItemExercise(drill, drill.answer)).toBe(true);
    expect(gradeItemExercise(drill, 1)).toBe(false);
    expect(gradeItemExercise(drill, "ho")).toBe(false);
  });

  it("a spoken drill still carries the options that make tapping possible", () => {
    // This is the property that keeps voice from ever being a dead end: no mic, no
    // key, denied permission, three mishearings — all fall back to these.
    expect(drill.options.length).toBeGreaterThanOrEqual(2);
    expect(drill.options[drill.answerIndex]).toBe(drill.answer);
  });
});

describe("the mishearing fallback", () => {
  it("gives up on speech after three consecutive overrides, not sooner", () => {
    // Once is noise. Twice could still be noise. Three in a row is recognition not
    // working for this voice today, and continuing to offer it is asking someone to
    // keep failing at something we already know is broken.
    expect(MISHEARD_STREAK_TO_FALL_BACK).toBe(3);
  });
});
