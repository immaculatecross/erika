import { registerInstruction, coerceRegister } from "../register";
import { profileBlock, type SpeakerProfile } from "../analysis/profile";
import type { SyllabusRule } from "../syllabus";
import type { Pos } from "../lexicon/pos";
import { extractJsonObject, TextModelParseError } from "./text-model";
import { budgetInstruction, MAX_DRILLS, MAX_EXAMPLES, MAX_NEW_WORDS, MIN_DRILLS, trimToBudget } from "./lesson-budget";
import { assertItalianLesson } from "./italian-language";
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

/** Italian display names for the POS scheme — prompt and learner-facing labels. */
const POS_LABEL: Record<Pos, string> = {
  NOUN: "nome", PROPN: "nome proprio", VERB: "verbo", AUX: "verbo ausiliare",
  ADJ: "aggettivo", ADV: "avverbio", PRON: "pronome", DET: "determinante",
  ADP: "preposizione", CCONJ: "congiunzione", INTJ: "interiezione",
};

export function posLabel(pos: Pos | null): string {
  return pos ? POS_LABEL[pos] : "parola";
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
  `Respond with JSON ONLY, no prose. Every learner-visible string MUST be Italian.`,
  `Every exercise is MEANING-FIRST: "prompt" is an Italian definition or a correct Italian sentence with a gap written "____".`,
  `NEVER put an incorrect or error form in a "prompt" — the cue is never the wrong answer. The correct form is always the retrieval target.`,
  `Every exercise has the SAME shape: {"prompt":string, "definition"?:string, "options":[string,...], "answerIndex":number, "answer":string, "invite":"click"|"speak", "rationale":string}.`,
  `"prompt", optional "definition", every "options" entry, "answer", and "rationale" MUST be Italian.`,
  `"options" is REQUIRED on every exercise and needs 2-3 plausible, DISTINCT Italian choices; "answerIndex" is 0-based and options[answerIndex] must equal "answer" exactly.`,
  `"invite" says how the learner answers first: "click" to tap an option, "speak" to say the answer aloud. Use a mix. A "speak" exercise still needs its options — they are the fallback when speech recognition fails.`,
  `"rationale" is ONE sentence saying why the answer is correct.`,
  `Include ${MIN_DRILLS}-${MAX_DRILLS} exercises.`,
];

/** Build the grammar-lesson prompt for a syllabus rule, colto-aware (D-23). */
export function grammarLessonPrompt(
  targetLanguage: string,
  register: string,
  rule: SyllabusRule,
  profile?: SpeakerProfile,
): string {
  return [
    `You are an expert ${targetLanguage} coach writing one short grammar lesson for an advanced learner.`,
    registerLine(register),
    // D-27's overlay, at its cheapest: the SYLLABUS decides what is taught, and the
    // learner's own profile (E-19 — their L1 and their recurring mistakes) decides
    // how it is angled. The backbone does not depend on it; a learner with no
    // recordings simply has no profile block and gets the same rule.
    ...(profile ? [profileBlock(profile)] : []),
    `Teach this rule (${rule.cefr}): "${rule.title}". ${rule.description}`,
    `Correct examples of the rule: ${rule.examples.join("; ")}.`,
    "",
    'Shape exactly: {"intro": string, "examples": [string,...], "exercises": [ ... ]}',
    `"intro" explains the rule entirely in Italian. "examples" holds up to ${MAX_EXAMPLES} short, CORRECT Italian sentences showing it.`,
    `The title, rule explanation and examples above are source material; do not copy any English wording into the response.`,
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
  profile?: SpeakerProfile,
): string {
  return [
    `You are an expert ${targetLanguage} coach writing one short vocabulary lesson for an advanced learner.`,
    registerLine(register),
    ...(profile ? [profileBlock(profile)] : []),
    `Teach the ${targetLanguage} ${posLabel(pos)} "${lemma}" together with a few closely related words.`,
    "",
    'Shape exactly: {"intro": string, "definition": string, "newWords": [{"lemma":string,"definition":string,"example":string}], "exercises": [ ... ]}',
    `"intro" and "definition" explain "${lemma}" entirely in Italian.`,
    `"newWords" holds up to ${MAX_NEW_WORDS} Italian words including "${lemma}", each with an Italian definition and one correct Italian example sentence.`,
    `Every learner-visible value in the JSON MUST be Italian, including definitions, examples, exercise cues, choices, answers and rationales.`,
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

/** The ONE bounded repair used when structurally valid output contains English. */
export const ITALIAN_REPAIR_INSTRUCTION = [
  "Your previous JSON contained English or materially mixed learner-visible text.",
  "Return the complete JSON object again with EVERY learner-visible value in Italian:",
  "intro, definition, newWords definitions and examples, exercise prompts, definitions, options, answers and rationales.",
  "Keep the same JSON keys and return JSON only.",
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
    if (typeof w.lemma !== "string" || typeof w.definition !== "string") continue;
    if (w.lemma.trim() === "" || w.definition.trim() === "") continue;
    out.push({
      lemma: w.lemma.trim(),
      definition: w.definition.trim(),
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

  const definition = typeof e.definition === "string" && e.definition.trim() ? e.definition.trim() : undefined;
  const invite = e.invite === "speak" ? "speak" : "click";
  return {
    type: "choice",
    prompt,
    options,
    answerIndex,
    answer,
    invite,
    rationale,
    ...(definition ? { definition } : {}),
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

  const definition = item.kind === "vocab" ? asString(obj.definition, "Lesson definition") : null;
  const lesson = trimToBudget({
    itemId: item.id,
    kind: item.kind,
    register,
    intro,
    examples: asStringList(obj.examples, MAX_EXAMPLES),
    newWords: item.kind === "vocab" ? asWords(obj.newWords) : [],
    definition,
    exercises,
  });
  assertItalianLesson(lesson);
  return lesson;
}
