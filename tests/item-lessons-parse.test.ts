import { describe, expect, it } from "vitest";
import {
  grammarLessonPrompt,
  vocabLessonPrompt,
  parseItemLessonResponse,
} from "@/lib/lessons/item-lessons";
import {
  applyGlossFallback,
  clozeIsDegraded,
  gradeItemExercise,
  MIN_ITEM_EXERCISES,
  type NewItemLesson,
} from "@/lib/lessons/item-lessons-view";
import { TextModelParseError } from "@/lib/lessons/text-model";
import { loadSyllabus } from "@/lib/syllabus";

// WO criteria 1 & 2 (shape/parse halves), pure and deterministic — no DB, no
// network. A generated grammar lesson has an explanation + ≥N exercises, each with
// a correct answer + rationale and a meaning-first stem (never an error form); a
// vocab lesson fronts meaning and applies the [P4] gloss-fallback to a degraded
// cloze; a malformed reply is rejected whole.

const RULE = loadSyllabus().rules[0]; // a real A1 rule (e.g. "alfabeto-suoni")
const GRAMMAR_ITEM = { id: `rule:${RULE.key}`, kind: "grammar" as const };
const VOCAB_ITEM = { id: "lemma:casa#NOUN", kind: "vocab" as const };

const GOOD_GRAMMAR = JSON.stringify({
  intro: "Italian spelling maps letters to sounds predictably; stress usually falls on the penult.",
  exercises: [
    {
      type: "multiple_choice",
      prompt: "Which spelling is correct for the word meaning 'house'?",
      options: ["casa", "kasa"],
      answerIndex: 0,
      answer: "casa",
      rationale: "Italian writes the /k/ before a with the letter c, not k.",
    },
    {
      type: "cloze",
      prompt: "Completa: la parola 'libro' si divide in li-____.",
      answer: "bro",
      derivable: true,
      rationale: "The syllable break falls before the consonant cluster.",
    },
    {
      type: "cloze",
      prompt: "Scrivi la sillaba mancante: ca-____ (casa).",
      answer: "sa",
      derivable: true,
      rationale: "casa splits ca-sa.",
    },
  ],
});

const GOOD_VOCAB = JSON.stringify({
  intro: "«casa» significa 'home'; è un sostantivo femminile. Esempio: «Torno a casa mia stasera».",
  glossEn: "house, home",
  exercises: [
    {
      type: "multiple_choice",
      prompt: "Which word means 'house'?",
      options: ["casa", "cassa"],
      answerIndex: 0,
      answer: "casa",
      rationale: "«casa» is home; «cassa» is a crate/till.",
    },
    // A well-formed cloze: the answer IS derivable from context → no gloss added.
    {
      type: "cloze",
      prompt: "Stasera torno a ____ dopo il lavoro.",
      answer: "casa",
      derivable: true,
      rationale: "The natural completion is 'a casa' (home).",
    },
    // A DEGRADED cloze (register upgrade, target not derivable) → gloss-fallback fires.
    {
      type: "cloze",
      prompt: "____",
      answer: "casa",
      derivable: false,
      rationale: "The target word, glossed for the learner.",
    },
  ],
});

describe("item-lesson prompts are colto-aware and meaning-first (criteria 1, 2, D-23)", () => {
  it("the grammar prompt injects the register and the rule, and forbids error stems", () => {
    const p = grammarLessonPrompt("Italian", "colto", RULE);
    expect(p).toContain("colto");
    expect(p).toContain(RULE.title);
    expect(p.toLowerCase()).toContain("meaning-first");
    expect(p).toMatch(/NEVER put an incorrect or error form/i);
  });

  it("the vocab prompt asks for a gloss and a correct in-register example", () => {
    const p = vocabLessonPrompt("Italian", "colto", "casa", "NOUN");
    expect(p).toContain("colto");
    expect(p).toContain("casa");
    expect(p).toContain("glossEn");
  });
});

describe("parsing a grammar lesson (criterion 1)", () => {
  it("yields the explanation + ≥N exercises, each with a correct answer and rationale", () => {
    const lesson = parseItemLessonResponse(GRAMMAR_ITEM, "colto", GOOD_GRAMMAR);
    expect(lesson.kind).toBe("grammar");
    expect(lesson.glossEn).toBeNull();
    expect(lesson.intro.length).toBeGreaterThan(0);
    expect(lesson.exercises.length).toBeGreaterThanOrEqual(MIN_ITEM_EXERCISES);
    for (const ex of lesson.exercises) {
      expect(ex.answer.length).toBeGreaterThan(0);
      expect(ex.rationale.length).toBeGreaterThan(0);
      expect(ex.prompt.length).toBeGreaterThan(0);
    }
  });

  it("no exercise stem is an error form: the MC stem is never a wrong option and the target IS the correct one", () => {
    const lesson = parseItemLessonResponse(GRAMMAR_ITEM, "colto", GOOD_GRAMMAR);
    for (const ex of lesson.exercises) {
      if (ex.type === "multiple_choice") {
        // The retrieval target is the correct option (parser enforces this)…
        expect(ex.options![ex.answerIndex!]).toBe(ex.answer);
        // …and the stem is not any of the wrong options (the cue is never the error).
        const wrong = ex.options!.filter((_, i) => i !== ex.answerIndex);
        for (const w of wrong) expect(ex.prompt).not.toBe(w);
      }
    }
  });

  it("rejects a multiple_choice whose answer is not the option at answerIndex (a wrong target)", () => {
    const bad = JSON.stringify({
      intro: "x",
      exercises: [
        { type: "multiple_choice", prompt: "p", options: ["right", "wrong"], answerIndex: 1, answer: "right", rationale: "r" },
      ],
    });
    expect(() => parseItemLessonResponse(GRAMMAR_ITEM, "colto", bad)).toThrow(TextModelParseError);
  });

  it("rejects a lesson with too few exercises, or a malformed reply, whole", () => {
    const tooFew = JSON.stringify({
      intro: "x",
      exercises: [{ type: "cloze", prompt: "a ____", answer: "b", rationale: "r" }],
    });
    expect(() => parseItemLessonResponse(GRAMMAR_ITEM, "colto", tooFew)).toThrow(TextModelParseError);
    expect(() => parseItemLessonResponse(GRAMMAR_ITEM, "colto", "not json")).toThrow(TextModelParseError);
  });
});

describe("parsing a vocab lesson + the [P4] gloss-fallback (criterion 2)", () => {
  it("requires a glossEn and fronts meaning", () => {
    const lesson = parseItemLessonResponse(VOCAB_ITEM, "colto", GOOD_VOCAB);
    expect(lesson.kind).toBe("vocab");
    expect(lesson.glossEn).toBe("house, home");
    const missing = JSON.stringify({ intro: "x", exercises: JSON.parse(GOOD_VOCAB).exercises });
    expect(() => parseItemLessonResponse(VOCAB_ITEM, "colto", missing)).toThrow(TextModelParseError);
  });

  it("a degraded cloze gets an English gloss front, an answerable one — never a bare ____", () => {
    const lesson = parseItemLessonResponse(VOCAB_ITEM, "colto", GOOD_VOCAB);
    const clozes = lesson.exercises.filter((e) => e.type === "cloze");
    const degraded = clozes.find((e) => e.prompt.trim() === "____")!;
    expect(degraded.gloss).toBe("house, home"); // gloss attached from the lemma gloss
    // The well-formed cloze (context makes the answer derivable) is left untouched.
    const wellFormed = clozes.find((e) => e.prompt.includes("torno a ____"))!;
    expect(wellFormed.gloss).toBeUndefined();
  });

  it("clozeIsDegraded flags a bare blank and a derivable:false flag, not a contextful gap", () => {
    expect(clozeIsDegraded({ type: "cloze", prompt: "____", answer: "casa", rationale: "r" })).toBe(true);
    expect(clozeIsDegraded({ type: "cloze", prompt: "x", answer: "y", derivable: false, rationale: "r" })).toBe(true);
    expect(
      clozeIsDegraded({ type: "cloze", prompt: "Stasera torno a ____ dopo il lavoro.", answer: "casa", rationale: "r" }),
    ).toBe(false);
  });

  it("applyGlossFallback is a no-op on a grammar lesson (no glossEn to use)", () => {
    const grammar: NewItemLesson = {
      itemId: "rule:x",
      kind: "grammar",
      register: "colto",
      intro: "i",
      glossEn: null,
      exercises: [{ type: "cloze", prompt: "____", answer: "a", derivable: false, rationale: "r" }],
    };
    expect(applyGlossFallback(grammar)).toEqual(grammar);
  });
});

describe("deterministic exercise grading (criterion 1/2)", () => {
  it("grades MC by index and cloze by normalized string match", () => {
    const lesson = parseItemLessonResponse(GRAMMAR_ITEM, "colto", GOOD_GRAMMAR);
    const mc = lesson.exercises.find((e) => e.type === "multiple_choice")!;
    expect(gradeItemExercise(mc, mc.answerIndex!)).toBe(true);
    expect(gradeItemExercise(mc, mc.answerIndex! === 0 ? 1 : 0)).toBe(false);
    const cloze = lesson.exercises.find((e) => e.type === "cloze")!;
    expect(gradeItemExercise(cloze, `  ${cloze.answer.toUpperCase()} `)).toBe(true); // case/space-insensitive
    expect(gradeItemExercise(cloze, "definitely wrong")).toBe(false);
  });
});
