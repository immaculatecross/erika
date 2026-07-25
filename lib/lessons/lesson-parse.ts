import { registerInstruction, coerceRegister } from "../register";
import type { SyllabusRule } from "../syllabus";
import type { Pos } from "../lexicon/pos";
import { extractJsonObject, TextModelParseError } from "./text-model";
import { budgetInstruction, MAX_DRILLS, MAX_EXAMPLES, MAX_NEW_WORDS, MIN_DRILLS, trimToBudget } from "./lesson-budget";
import {
  MIN_ITEM_EXERCISES,
  usableDrills,
  type ItemExercise,
  type ItemLessonKind,
  type LessonWord,
  type NewItemLesson,
} from "./item-lessons-view";

// The prompts and the parser for a GENERATED lesson (E-45; extracted from
// item-lessons.ts under the 500-line hook). Pure: no DB, no network, so fixture
// tests drive them directly and no CI test ever makes a real call.
//
// The prompt asks for the SAME shape the deterministic syllabus builder produces —
// one exercise kind, options always present, an invite of click or speak — so the
// two content sources are interchangeable inside one runner. That is the whole of
// "one lesson format": not two systems politely agreeing, but one type.

/** English display names for the POS scheme — for the vocab prompt and labels only. */
const POS_LABEL: Record<Pos, string> = {
  NOUN: "noun", PROPN: "proper noun", VERB: "verb", AUX: "auxiliary verb",
  ADJ: "adjective", ADV: "adverb", PRON: "pronoun", DET: "determiner",
  ADP: "preposition", CCONJ: "conjunction", INTJ: "interjection",
};

export function posLabel(pos: Pos | null): string {
  return pos ? POS_LABEL[pos] : "word";
}

/** The register guidance injected into every prompt (E-33, D-23) — the shared dial
 *  instruction, one source for recasts, lessons, TTS and the tutor. */
function registerLine(register: string): string {
  return registerInstruction(coerceRegister(register));
}

// ── prompts ──────────────────────────────────────────────────────────────────

/**
 * The exercise contract. One kind, and the two rules that make voice safe:
 * `options` is mandatory even on a spoken drill (so there is always a click path),
 * and the cue is never an error form (D-18).
 */
const EXERCISE_RULES = [
  `Respond with JSON ONLY, no prose. Every exercise is MEANING-FIRST: "prompt" is an English instruction/gloss or an Italian sentence with a gap written "____".`,
  `NEVER put an incorrect or error form in a "prompt" — the cue is never the wrong answer. The correct form is always the retrieval target.`,
  `Every exercise has the SAME shape: {"prompt":string, "options":[string,...], "answerIndex":number, "answer":string, "invite":"click"|"speak", "rationale":string}.`,
  `"options" is REQUIRED on every exercise and needs 2-3 plausible, DISTINCT choices in the target language; "answerIndex" is 0-based and options[answerIndex] must equal "answer" exactly.`,
  `"invite" says how the learner answers first: "click" to tap an option, "speak" to say the answer aloud. Use a mix. A "speak" exercise still needs its options — they are the fallback when speech recognition fails.`,
  `"rationale" is ONE sentence saying why the answer is correct.`,
  `Include ${MIN_DRILLS}-${MAX_DRILLS} exercises.`,
];

/** Build the grammar-lesson prompt for a syllabus rule, colto-aware (D-23). */
export function grammarLessonPrompt(targetLanguage: string, register: string, rule: SyllabusRule): string {
  return [
    `You are an expert ${targetLanguage} coach writing one short grammar lesson for an advanced learner.`,
    registerLine(register),
    `Teach this rule (${rule.cefr}): "${rule.title}". ${rule.description}`,
    `Correct examples of the rule: ${rule.examples.join("; ")}.`,
    "",
    'Shape exactly: {"intro": string, "examples": [string,...], "exercises": [ ... ]}',
    `"intro" explains the rule in plain English. "examples" holds up to ${MAX_EXAMPLES} short, CORRECT ${targetLanguage} sentences showing it.`,
    ...EXERCISE_RULES,
    budgetInstruction(),
  ].join("\n");
}

/** Build the vocabulary-lesson prompt for a lemma, colto-aware (D-23). */
export function vocabLessonPrompt(
  targetLanguage: string,
  register: string,
  lemma: string,
  pos: Pos | null,
): string {
  return [
    `You are an expert ${targetLanguage} coach writing one short vocabulary lesson for an advanced learner.`,
    registerLine(register),
    `Teach the ${targetLanguage} ${posLabel(pos)} "${lemma}" together with a few closely related words.`,
    "",
    'Shape exactly: {"intro": string, "glossEn": string, "newWords": [{"lemma":string,"gloss":string,"example":string}], "exercises": [ ... ]}',
    `"intro" gives the meaning in plain English. "glossEn" is a short English gloss of "${lemma}".`,
    `"newWords" holds up to ${MAX_NEW_WORDS} words including "${lemma}", each with an English gloss and one correct ${targetLanguage} example sentence.`,
    ...EXERCISE_RULES,
    budgetInstruction(),
  ].join("\n");
}

/** The extra line the ONE bounded repair retry adds after a truncated reply. */
export const BREVITY_RETRY_INSTRUCTION = [
  "Your previous answer was cut off because it was too long.",
  `Answer again, MUCH shorter: the minimum is fine — ${MIN_DRILLS} exercises, a two-sentence intro, no extra commentary.`,
  "Return the complete JSON object and nothing else.",
].join(" ");

// ── parsing ──────────────────────────────────────────────────────────────────

function asString(v: unknown, ctx: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new TextModelParseError(`${ctx} must be a non-empty string.`);
  return v.trim();
}

function asStringList(v: unknown, max: number): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, max);
}

function asWords(v: unknown): LessonWord[] {
  if (!Array.isArray(v)) return [];
  const out: LessonWord[] = [];
  for (const raw of v) {
    if (typeof raw !== "object" || raw === null) continue;
    const w = raw as Record<string, unknown>;
    if (typeof w.lemma !== "string" || typeof w.gloss !== "string") continue;
    if (w.lemma.trim() === "" || w.gloss.trim() === "") continue;
    out.push({
      lemma: w.lemma.trim(),
      gloss: w.gloss.trim(),
      ...(typeof w.example === "string" && w.example.trim() ? { example: w.example.trim() } : {}),
    });
    if (out.length >= MAX_NEW_WORDS) break;
  }
  return out;
}

/**
 * Validate one exercise, or return null.
 *
 * NULL RATHER THAN THROW, deliberately, and it is the same lesson E-42 learned on
 * the analysis path: rejecting the WHOLE reply because one exercise of five was
 * malformed threw away four good ones the learner had already paid for. A dropped
 * exercise is topped up from the deterministic syllabus drills, so the lesson is
 * still complete — where a rejected reply used to mean a billed call and nothing
 * on screen.
 */
function parseExercise(raw: unknown): ItemExercise | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const prompt = typeof e.prompt === "string" ? e.prompt.trim() : "";
  const answer = typeof e.answer === "string" ? e.answer.trim() : "";
  const rationale = typeof e.rationale === "string" ? e.rationale.trim() : "";
  if (!prompt || !answer || !rationale) return null;
  if (!Array.isArray(e.options)) return null;

  const options = e.options
    .filter((o): o is string => typeof o === "string" && o.trim() !== "")
    .map((o) => o.trim());
  if (options.length < 2) return null;

  // Trust the ANSWER over the index: a model that lists the right options and
  // mis-numbers them has still written a usable drill, and re-deriving the index
  // is cheaper and safer than discarding it.
  const answerIndex = options.findIndex((o) => o === answer);
  if (answerIndex < 0) return null;

  const gloss = typeof e.gloss === "string" && e.gloss.trim() ? e.gloss.trim() : undefined;
  const invite = e.invite === "speak" ? "speak" : "click";
  return {
    type: "choice",
    prompt,
    options,
    answerIndex,
    answer,
    invite,
    rationale,
    ...(gloss ? { gloss } : {}),
  };
}

/**
 * Parse a model reply into a validated lesson, or throw truthfully.
 *
 * `fallbackDrills` are the deterministic syllabus drills for the same item. They
 * top the lesson up to MIN_ITEM_EXERCISES when the reply produced fewer usable
 * ones — so a partly-bad reply degrades into a complete lesson instead of an
 * error, and the learner never pays for a call that shows them nothing.
 *
 * Only a reply with NO intro at all is rejected outright: there is nothing to
 * teach, and the caller answers with the deterministic lesson instead.
 */
export function parseItemLessonResponse(
  item: { id: string; kind: ItemLessonKind },
  register: string,
  raw: string,
  fallbackDrills: readonly ItemExercise[] = [],
): NewItemLesson {
  const obj = extractJsonObject(raw);
  const intro = asString(obj.intro, "Lesson intro");

  const parsed = Array.isArray(obj.exercises) ? obj.exercises.map(parseExercise) : [];
  const exercises = usableDrills(parsed.filter((e): e is ItemExercise => e !== null));
  for (const drill of fallbackDrills) {
    if (exercises.length >= MIN_ITEM_EXERCISES) break;
    if (exercises.some((e) => e.prompt === drill.prompt)) continue;
    exercises.push(drill);
  }
  if (exercises.length < MIN_ITEM_EXERCISES) {
    throw new TextModelParseError(`Lesson needs at least ${MIN_ITEM_EXERCISES} usable exercises.`);
  }

  const glossEn = item.kind === "vocab" ? asString(obj.glossEn, "Lesson glossEn") : null;
  return trimToBudget({
    itemId: item.id,
    kind: item.kind,
    register,
    intro,
    examples: asStringList(obj.examples, MAX_EXAMPLES),
    newWords: item.kind === "vocab" ? asWords(obj.newWords) : [],
    glossEn,
    exercises,
  });
}
