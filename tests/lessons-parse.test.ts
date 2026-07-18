import { describe, expect, it } from "vitest";
import { parseLessonResponse, lessonPrompt } from "@/lib/lessons/generate";
import { parseGradeResponse, gradePrompt } from "@/lib/lessons/grade";
import { TextModelParseError } from "@/lib/lessons/text-model";
import type { Pattern } from "@/lib/lessons/patterns";
import type { Finding } from "@/lib/analysis/findings";

// WO criteria 2 & 3 (parsing halves) — a good lesson/grade response parses into
// typed shapes; a malformed or partial one rejects the WHOLE response truthfully
// so nothing is persisted or recorded. Fenced/prose JSON is tolerated (E-4 lesson).

const GOOD_LESSON = JSON.stringify({
  explanation: "Use the subjunctive after expressions of doubt.",
  exercises: [
    { type: "multiple_choice", prompt: "Pick the correct form", options: ["sia", "è"], answerIndex: 0 },
    { type: "fill_in", prompt: "Penso che lui ___ (essere) qui", answer: "sia" },
    { type: "rewrite", prompt: "Rewrite: Credo che è vero", target: "Credo che sia vero" },
  ],
});

describe("lesson generation parsing (criterion 2)", () => {
  it("parses a well-formed response into three typed exercises", () => {
    const { explanation, exercises } = parseLessonResponse(GOOD_LESSON);
    expect(explanation).toMatch(/subjunctive/);
    expect(exercises.map((e) => e.type)).toEqual(["multiple_choice", "fill_in", "rewrite"]);
    const mc = exercises[0];
    if (mc.type !== "multiple_choice") throw new Error("expected MC");
    expect(mc.options).toEqual(["sia", "è"]);
    expect(mc.answerIndex).toBe(0);
  });

  it("tolerates a JSON object wrapped in a markdown fence or prose", () => {
    const fenced = "```json\n" + GOOD_LESSON + "\n```";
    const prose = "Here is the lesson:\n" + GOOD_LESSON + "\nHope it helps.";
    expect(parseLessonResponse(fenced).exercises).toHaveLength(3);
    expect(parseLessonResponse(prose).exercises).toHaveLength(3);
  });

  it("rejects malformed or partial output whole (no partial lesson)", () => {
    const base = JSON.parse(GOOD_LESSON);
    const cases = [
      "not json",
      JSON.stringify({ explanation: "", exercises: base.exercises }), // empty explanation
      JSON.stringify({ explanation: "x", exercises: [] }), // no exercises
      JSON.stringify({ explanation: "x", exercises: [{ type: "essay", prompt: "p" }] }), // bad type
      JSON.stringify({ explanation: "x", exercises: [{ type: "multiple_choice", prompt: "p", options: ["a"], answerIndex: 0 }] }), // too few options
      JSON.stringify({ explanation: "x", exercises: [{ type: "multiple_choice", prompt: "p", options: ["a", "b"], answerIndex: 5 }] }), // OOB answer
      JSON.stringify({ explanation: "x", exercises: [{ type: "fill_in", prompt: "p" }] }), // missing answer
      JSON.stringify({ explanation: "x", exercises: [{ type: "rewrite", prompt: "p" }] }), // missing target
    ];
    for (const raw of cases) {
      expect(() => parseLessonResponse(raw)).toThrow(TextModelParseError);
    }
  });
});

describe("rewrite grading parsing (criterion 3)", () => {
  it("parses a correct and an incorrect verdict", () => {
    expect(parseGradeResponse('{"correct":true,"feedback":"Nicely done."}')).toEqual({
      correct: true,
      feedback: "Nicely done.",
    });
    expect(parseGradeResponse('{"correct":false,"feedback":"Watch the verb."}')).toEqual({
      correct: false,
      feedback: "Watch the verb.",
    });
  });

  it("rejects a malformed grade truthfully", () => {
    for (const raw of ["nope", "{}", '{"correct":"yes","feedback":"x"}', '{"correct":true,"feedback":""}']) {
      expect(() => parseGradeResponse(raw)).toThrow(TextModelParseError);
    }
  });
});

describe("prompts are grounded in the learner's findings", () => {
  const pattern: Pattern = {
    key: "category:grammar",
    category: "grammar",
    count: 3,
    findings: [
      { id: "f1", sessionId: "s", contentHash: "h", quote: "I have 25 years", correction: "I am 25", category: "grammar", explanation: "age uses to be", severity: "high", startMs: 0, endMs: 0 },
    ] as Finding[],
  };

  it("the lesson prompt names the category, the user's quote, and requests JSON", () => {
    const p = lessonPrompt("Italian", pattern);
    expect(p).toMatch(/grammar/);
    expect(p).toMatch(/I have 25 years/);
    expect(p).toMatch(/JSON/i);
  });

  it("the grade prompt carries target and rewrite", () => {
    const p = gradePrompt("Italian", "Credo che sia vero", "Credo che è vero");
    expect(p).toMatch(/Credo che sia vero/);
    expect(p).toMatch(/Credo che è vero/);
    expect(p).toMatch(/JSON/i);
  });
});
