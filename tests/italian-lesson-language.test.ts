import { describe, expect, it } from "vitest";
import {
  assertItalianLesson,
  ItalianLessonLanguageError,
  learnerVisibleLessonFields,
  validateItalianText,
} from "@/lib/lessons/italian-language";
import { parseItemLessonResponse } from "@/lib/lessons/lesson-parse";
import type { ItemLesson } from "@/lib/lessons/item-lessons-view";

const ITALIAN: ItemLesson = {
  itemId: "lemma:casa#NOUN",
  kind: "vocab",
  register: "colto",
  intro: "La casa è l'edificio o il luogo in cui una persona abita con la propria famiglia.",
  definition: "Edificio o luogo stabile in cui si abita.",
  examples: ["Dopo il lavoro torno a casa.", "La loro casa si trova vicino al mare."],
  newWords: [
    {
      lemma: "abitazione",
      definition: "Luogo destinato alla vita quotidiana di una persona o di una famiglia.",
      example: "Questa abitazione è luminosa e silenziosa.",
    },
  ],
  exercises: [
    {
      type: "choice",
      prompt: "Quale parola indica il luogo in cui si abita?",
      definition: "Luogo della vita domestica.",
      options: ["casa", "cassa"],
      answerIndex: 0,
      answer: "casa",
      invite: "click",
      rationale: "Casa indica il luogo in cui una persona abita.",
    },
    {
      type: "choice",
      prompt: "Dopo il lavoro torno a ____.",
      options: ["casa", "cassa"],
      answerIndex: 0,
      answer: "casa",
      invite: "speak",
      rationale: "La locuzione corretta è tornare a casa.",
    },
  ],
};

function grammarReply(intro: string): string {
  return JSON.stringify({
    intro,
    examples: ["Ieri sono andato al mare."],
    exercises: [
      {
        prompt: "Ieri ____ andato al mare.",
        options: ["sono", "ho"],
        answerIndex: 0,
        answer: "sono",
        invite: "click",
        rationale: "Il verbo andare richiede l'ausiliare essere.",
      },
      {
        prompt: "Maria è ____ a casa.",
        options: ["tornata", "tornato"],
        answerIndex: 0,
        answer: "tornata",
        invite: "speak",
        rationale: "Con essere il participio concorda con il soggetto.",
      },
    ],
  });
}

const REVIEWER_ENGLISH = JSON.stringify({
  intro: "Modal verbs need careful study",
  examples: ["People speak clearly"],
  exercises: [
    {
      prompt: "Find matching form",
      options: ["can", "could"],
      answerIndex: 0,
      answer: "can",
      invite: "click",
      rationale: "Can shows possibility",
    },
    {
      prompt: "Find suitable phrase",
      options: ["might", "must"],
      answerIndex: 0,
      answer: "might",
      invite: "speak",
      rationale: "Might shows uncertainty",
    },
  ],
});

describe("bounded Italian-language validation", () => {
  it("accepts a complete Italian lesson and checks every visible field", () => {
    expect(() => assertItalianLesson(ITALIAN)).not.toThrow();
    const paths = learnerVisibleLessonFields(ITALIAN).map((field) => field.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "intro",
        "definition",
        "newWords[0].definition",
        "newWords[0].example",
        "exercises[0].prompt",
        "exercises[0].definition",
        "exercises[0].options[0]",
        "exercises[0].answer",
        "exercises[0].rationale",
      ]),
    );
  });

  it("rejects an all-English model response", () => {
    expect(() =>
      parseItemLessonResponse(
        { id: "rule:ausiliare-scelta", kind: "grammar" },
        "colto",
        grammarReply("The auxiliary is chosen according to the verb and the sentence meaning."),
      ),
    ).toThrow(ItalianLessonLanguageError);
  });

  it("rejects the reviewer's all-short-field English lesson as one body", () => {
    expect(() =>
      parseItemLessonResponse(
        { id: "rule:presente-modali", kind: "grammar" },
        "colto",
        REVIEWER_ENGLISH,
      ),
    ).toThrow(ItalianLessonLanguageError);
  });

  it("rejects materially mixed English and Italian prose", () => {
    expect(() =>
      parseItemLessonResponse(
        { id: "rule:ausiliare-scelta", kind: "grammar" },
        "colto",
        grammarReply(
          "Il passato prossimo descrive un evento concluso, but the auxiliary must agree with the kind of verb and the sentence meaning.",
        ),
      ),
    ).toThrow(ItalianLessonLanguageError);
  });

  it("accepts the reviewer's valid Italian sentence without whitelist signals", () => {
    expect(validateItalianText("Mario guarda Luca mentre corre veloce")).toMatchObject({
      valid: true,
    });
  });

  it("states the honest limit for one-to-five-token grammar strings", () => {
    for (const token of ["gli", "c'è", "avrei", "fossi", "ne"]) {
      expect(validateItalianText(token), token).toMatchObject({ valid: true });
    }
    expect(validateItalianText("sa")).toMatchObject({ valid: true });
    expect(validateItalianText("can")).toMatchObject({ valid: true });
    expect(() =>
      parseItemLessonResponse(
        { id: "rule:presente-modali", kind: "grammar" },
        "colto",
        REVIEWER_ENGLISH,
      ),
    ).toThrow(ItalianLessonLanguageError);
  });
});
