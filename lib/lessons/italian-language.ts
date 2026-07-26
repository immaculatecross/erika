import { detectAll } from "tinyld";
import type { ItemLesson } from "./item-lessons-view";
import { TextModelParseError } from "./text-model";

// A bounded, deterministic statistical classifier for lesson content. tinyld's
// bundled language model avoids a hand-maintained word denylist and gives ordinary
// names/verbs ("Mario guarda Luca mentre corre veloce") the same treatment as
// grammatical prose.
//
// Honest limit: one-to-five-token strings cannot always be classified reliably
// (names, inflections and homographs such as Italian "so" are open-ended), so one-
// and two-token fields and ambiguous short non-English results are accepted
// individually. Classifiable English prose is rejected, and `assertItalianLesson`
// classifies the complete body, so short English fields cannot assemble a passing
// lesson.

const MAX_FIELDS = 96;
const MAX_TOKENS_PER_FIELD = 256;

function tokensOf(text: string): string[] {
  return text
    .toLocaleLowerCase("it")
    .match(/\p{L}+(?:['’]\p{L}+)?/gu)
    ?.slice(0, MAX_TOKENS_PER_FIELD) ?? [];
}

function italianEnglishScores(text: string): { italian: number; english: number } {
  const ranked = detectAll(text);
  return {
    italian: ranked.find(({ lang }) => lang === "it")?.accuracy ?? 0,
    english: ranked.find(({ lang }) => lang === "en")?.accuracy ?? 0,
  };
}

export interface ItalianTextResult {
  valid: boolean;
  reason: "empty" | "english" | "mixed" | "no-italian-signal" | null;
  tokenCount: number;
}

export function validateItalianText(text: string): ItalianTextResult {
  const tokens = tokensOf(text.trim());
  if (tokens.length === 0) return { valid: false, reason: "empty", tokenCount: 0 };
  if (tokens.length <= 2) return { valid: true, reason: null, tokenCount: tokens.length };
  if (tokens.length <= 5 && text.includes("____")) {
    return { valid: true, reason: null, tokenCount: tokens.length };
  }

  const { italian: italianScore, english: englishScore } = italianEnglishScores(text.trim());
  if (italianScore > englishScore) {
    return { valid: true, reason: null, tokenCount: tokens.length };
  }
  // Short grammar forms, blanks and names are often reported as another Romance
  // language or unknown. Explicit English is still rejected; ambiguity is covered
  // by the strict whole-lesson Italian classification in `assertItalianLesson`.
  if (tokens.length <= 5 && englishScore === 0) {
    return { valid: true, reason: null, tokenCount: tokens.length };
  }
  return {
    valid: false,
    reason: englishScore > italianScore ? "english" : "no-italian-signal",
    tokenCount: tokens.length,
  };
}

export class ItalianLessonLanguageError extends TextModelParseError {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`Lesson contains non-Italian learner-visible content: ${fields.join(", ")}.`);
    this.fields = fields;
  }
}

interface VisibleField {
  path: string;
  text: string;
}

/** Every string a learner can see in one lesson, including answer feedback. */
export function learnerVisibleLessonFields(lesson: ItemLesson): VisibleField[] {
  const fields: VisibleField[] = [{ path: "intro", text: lesson.intro }];
  if (lesson.definition) fields.push({ path: "definition", text: lesson.definition });
  lesson.examples.forEach((text, i) => fields.push({ path: `examples[${i}]`, text }));
  lesson.newWords.forEach((word, i) => {
    fields.push({ path: `newWords[${i}].lemma`, text: word.lemma });
    fields.push({ path: `newWords[${i}].definition`, text: word.definition });
    if (word.example) fields.push({ path: `newWords[${i}].example`, text: word.example });
  });
  lesson.exercises.forEach((exercise, i) => {
    fields.push({ path: `exercises[${i}].prompt`, text: exercise.prompt });
    if (exercise.definition) fields.push({ path: `exercises[${i}].definition`, text: exercise.definition });
    exercise.options.forEach((text, j) => fields.push({ path: `exercises[${i}].options[${j}]`, text }));
    fields.push({ path: `exercises[${i}].answer`, text: exercise.answer });
    fields.push({ path: `exercises[${i}].rationale`, text: exercise.rationale });
  });
  return fields;
}

export function assertItalianLesson(lesson: ItemLesson): void {
  const fields = learnerVisibleLessonFields(lesson);
  if (fields.length > MAX_FIELDS) {
    throw new ItalianLessonLanguageError(["too-many-fields"]);
  }
  const rejected = fields
    .filter(({ text }) => !validateItalianText(text).valid)
    .map(({ path }) => path);
  const whole = italianEnglishScores(fields.map(({ text }) => text).join(". "));
  if (whole.italian === 0 || whole.italian <= whole.english) rejected.push("$lesson");
  if (rejected.length > 0) throw new ItalianLessonLanguageError(rejected);
}
