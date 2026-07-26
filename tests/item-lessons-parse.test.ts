import { describe, expect, it } from "vitest";
import {
  BREVITY_RETRY_INSTRUCTION,
  grammarLessonPrompt,
  parseItemLessonResponse,
  vocabLessonPrompt,
} from "@/lib/lessons/lesson-parse";
import {
  MAX_DRILLS,
  MAX_EXAMPLES,
  MAX_INTRO_WORDS,
  MIN_DRILLS,
  lessonFitsBudget,
} from "@/lib/lessons/lesson-budget";
import { MIN_ITEM_EXERCISES, drillIsUsable, type ItemExercise } from "@/lib/lessons/item-lessons-view";
import { TextModelParseError } from "@/lib/lessons/text-model";
import { loadSyllabus } from "@/lib/syllabus";
import { ruleDrills } from "@/lib/lessons/syllabus-lesson";

// The GENERATED lesson's prompt and parser (E-45). Pure — no DB, no model call.
//
// The parser's job changed shape at E-45 and the tests follow it. It used to reject
// the WHOLE reply if one exercise of five was malformed, which meant a billed call
// and nothing on screen; it now drops the bad exercise and TOPS THE LESSON UP from
// the deterministic syllabus drills, so a partly-bad reply still becomes a complete
// lesson. Expectations are derived from the fixture we wrote, never from the
// parser's own answer.

const RULE = loadSyllabus().rules.find((r) => r.key === "ausiliare-scelta")!;
const FALLBACK = ruleDrills(RULE);
const GRAMMAR_ITEM = { id: "rule:ausiliare-scelta", kind: "grammar" as const };
const VOCAB_ITEM = { id: "lemma:casa#NOUN", kind: "vocab" as const };

function drill(over: Partial<ItemExercise> = {}): Record<string, unknown> {
  return {
    prompt: "Ieri ____ andato al mare.",
    options: ["sono", "ho"],
    answerIndex: 0,
    answer: "sono",
    invite: "click",
    rationale: "Il verbo andare richiede l'ausiliare essere.",
    ...over,
  };
}

function reply(body: Record<string, unknown>): string {
  return JSON.stringify(body);
}

describe("the prompt states the contract the runner depends on", () => {
  const prompt = grammarLessonPrompt("Italian", "colto", RULE);

  it("demands options on EVERY exercise, including a spoken one", () => {
    // The click fallback is what keeps a voice drill from becoming a dead end, so
    // the model has to be told it is mandatory rather than left to infer it.
    expect(prompt).toContain('"options" is REQUIRED on every exercise');
    expect(prompt).toContain("they are the fallback when speech recognition fails");
  });

  it("never invites a typed answer", () => {
    for (const banned of ["fill_in", "rewrite", "cloze", "type the", "typed"]) {
      expect(prompt.toLowerCase()).not.toContain(banned);
    }
  });

  it("states the five-minute budget in numbers the model can obey", () => {
    expect(prompt).toContain(`at most ${MAX_INTRO_WORDS} words`);
    expect(prompt).toContain(`at most ${MAX_EXAMPLES} worked examples`);
    expect(prompt).toContain(`exactly ${MIN_DRILLS}-${MAX_DRILLS} exercises`);
  });

  it("the brevity retry asks for LESS, which is the only thing that can fix a truncation", () => {
    expect(BREVITY_RETRY_INSTRUCTION).toContain("cut off");
    expect(BREVITY_RETRY_INSTRUCTION).toContain("MUCH shorter");
  });

  it("a vocabulary prompt requires Italian definitions in the public shape", () => {
    const vocab = vocabLessonPrompt("Italian", "colto", "casa", "NOUN");
    expect(vocab).toContain('"definition"');
    expect(vocab).not.toContain("glossEn");
    expect(vocab).toContain("Every learner-visible string MUST be Italian");
  });
});

describe("drillIsUsable — each clause, on its own", () => {
  // A table, one malformation per row, so every clause has a test that goes red
  // when only that clause is deleted. Grouping them into one "malformed drill"
  // fixture is how a guard ends up unkillable: an earlier clause catches the input
  // and the later ones are never reached.
  const good = {
    type: "choice" as const,
    prompt: "Ieri ____ andato.",
    options: ["sono", "ho"],
    answerIndex: 0,
    answer: "sono",
    invite: "click" as const,
    rationale: "essere.",
  };

  it("accepts a well-formed drill", () => {
    expect(drillIsUsable(good)).toBe(true);
  });

  const bad: [string, Partial<ItemExercise>][] = [
    ["no cue", { prompt: "  " }],
    ["no answer", { answer: "" }],
    ["no reason", { rationale: "" }],
    // The click fallback is what keeps a voice drill from becoming a dead end, so
    // "options are optional" must be a test failure, not a style question.
    ["one option", { options: ["sono"] }],
    ["no options at all", { options: undefined as unknown as string[] }],
    ["answerIndex out of range", { answerIndex: 5 }],
    ["answerIndex negative", { answerIndex: -1 }],
    // The answer key must actually point at the answer, or clicking the right
    // option grades wrong — the same betrayal as a mishearing, from our own bug.
    ["answer is not the option at answerIndex", { answer: "boh" }],
    ["duplicate options", { options: ["sono", "sono"], answer: "sono", answerIndex: 0 }],
  ];

  for (const [name, over] of bad) {
    it(`rejects: ${name}`, () => {
      expect(drillIsUsable({ ...good, ...over } as ItemExercise)).toBe(false);
    });
  }
});

describe("parseItemLessonResponse — a usable lesson or a truthful failure", () => {
  it("parses a well-formed reply into the one exercise shape", () => {
    const lesson = parseItemLessonResponse(
      GRAMMAR_ITEM,
      "colto",
      reply({
        intro: "Il verbo andare forma il passato prossimo con l'ausiliare essere.",
        examples: ["Sono andato al mare."],
        exercises: [drill(), drill({ invite: "speak", prompt: "Ieri ____ corso.", answer: "sono" })],
      }),
    );
    expect(lesson.exercises).toHaveLength(2);
    expect(lesson.exercises.every(drillIsUsable)).toBe(true);
    expect(lesson.exercises.map((e) => e.invite)).toEqual(["click", "speak"]);
    expect(lesson.examples).toEqual(["Sono andato al mare."]);
    expect(lessonFitsBudget(lesson)).toBe(true);
  });

  it("re-derives answerIndex from the answer rather than trusting a mis-numbered reply", () => {
    // Ground truth from the fixture: "sono" sits at index 0, the reply says 1.
    const lesson = parseItemLessonResponse(
      GRAMMAR_ITEM,
      "colto",
      reply({ intro: "x", exercises: [drill({ answerIndex: 1 }), drill()] }),
    );
    expect(lesson.exercises[0].answerIndex).toBe(0);
    expect(lesson.exercises[0].options[lesson.exercises[0].answerIndex]).toBe("sono");
  });

  it("DROPS a malformed exercise and tops the lesson up from the syllabus drills", () => {
    // One good exercise, two unusable ones (no options; answer absent from options).
    const lesson = parseItemLessonResponse(
      GRAMMAR_ITEM,
      "colto",
      reply({
        intro: "Il verbo andare forma il passato prossimo con l'ausiliare essere.",
        exercises: [drill(), { prompt: "p", answer: "a", rationale: "r" }, drill({ answer: "nowhere" })],
      }),
      FALLBACK,
    );
    // The lesson survives at the floor, and every exercise in it is renderable.
    expect(lesson.exercises.length).toBeGreaterThanOrEqual(MIN_ITEM_EXERCISES);
    expect(lesson.exercises.every(drillIsUsable)).toBe(true);
    // The top-up really came from the deterministic set, not from thin air.
    expect(lesson.exercises.some((e) => FALLBACK.some((f) => f.prompt === e.prompt))).toBe(true);
  });

  it("refuses only when NOTHING usable survives and there is no fallback", () => {
    expect(() =>
      parseItemLessonResponse(GRAMMAR_ITEM, "colto", reply({ intro: "x", exercises: [{ prompt: "p" }] })),
    ).toThrow(TextModelParseError);
  });

  it("refuses a reply with no intro — there is nothing to teach", () => {
    expect(() =>
      parseItemLessonResponse(GRAMMAR_ITEM, "colto", reply({ exercises: [drill(), drill()] }), FALLBACK),
    ).toThrow(TextModelParseError);
  });

  it("refuses a vocabulary lesson with no Italian definition", () => {
    expect(() =>
      parseItemLessonResponse(VOCAB_ITEM, "colto", reply({ intro: "x", exercises: [drill(), drill()] })),
    ).toThrow(TextModelParseError);
  });

  it("carries a vocabulary lesson's Italian words and definitions", () => {
    const lesson = parseItemLessonResponse(
      VOCAB_ITEM,
      "colto",
      reply({
        intro: "La casa è l'edificio o il luogo in cui una persona abita.",
        definition: "Edificio o luogo in cui si abita.",
        newWords: [
          { lemma: "casa", definition: "Edificio o luogo in cui si abita.", example: "Torno a casa." },
          { lemma: "", definition: "voce non valida" },
        ],
        exercises: [drill(), drill()],
      }),
    );
    expect(lesson.definition).toBe("Edificio o luogo in cui si abita.");
    // The malformed word is dropped, the good one kept — same policy as exercises.
    expect(lesson.newWords).toEqual([
      { lemma: "casa", definition: "Edificio o luogo in cui si abita.", example: "Torno a casa." },
    ]);
  });

  it("TRIMS an over-budget reply instead of rejecting work the learner paid for", () => {
    const lesson = parseItemLessonResponse(
      GRAMMAR_ITEM,
      "colto",
      reply({
        intro: Array.from({ length: MAX_INTRO_WORDS * 3 }, () => "parola").join(" "),
        examples: Array.from({ length: MAX_EXAMPLES + 6 }, (_, i) => `Esempio ${i}.`),
        exercises: Array.from({ length: MAX_DRILLS + 5 }, (_, i) => drill({ prompt: `Cue ${i} ____ .` })),
      }),
    );
    // Expectations from the CAPS, not from what the parser returned.
    expect(lesson.intro.split(/\s+/).length).toBeLessThanOrEqual(MAX_INTRO_WORDS);
    expect(lesson.examples.length).toBeLessThanOrEqual(MAX_EXAMPLES);
    expect(lesson.exercises.length).toBeLessThanOrEqual(MAX_DRILLS);
    // And the POSITIVE: a real lesson still exists and it fits the promise.
    expect(lesson.exercises.length).toBeGreaterThanOrEqual(MIN_DRILLS);
    expect(lessonFitsBudget(lesson)).toBe(true);
  });

  it("tolerates a fenced reply", () => {
    const lesson = parseItemLessonResponse(
      GRAMMAR_ITEM,
      "colto",
      "```json\n" + reply({ intro: "x", exercises: [drill(), drill()] }) + "\n```",
    );
    expect(lesson.exercises).toHaveLength(2);
  });
});
