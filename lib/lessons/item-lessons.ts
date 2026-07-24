import type { Db } from "../db";
import { readSettings } from "../settings";
import { registerInstruction, coerceRegister, type Register } from "../register";
import { finalizeReservation } from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import { parseItemId } from "../knowledge/items";
import { loadSyllabus, type SyllabusRule } from "../syllabus";
import type { Pos } from "../lexicon/pos";
import { extractJsonObject, TextModelParseError, type TextModelClient } from "./text-model";
import { parseBilledResponse, runBilledTextCall } from "./billing";
import {
  applyGlossFallback,
  ITEM_EXERCISE_TYPES,
  MIN_ITEM_EXERCISES,
  type ItemExercise,
  type ItemLesson,
  type ItemLessonKind,
  type NewItemLesson,
} from "./item-lessons-view";

// E-32 item-lesson generation (WO criteria 1-3, D-18/D-19/D-23). Turn ONE
// composer-chosen knowledge item into a doable micro-lesson via ONE budget-checked
// text-model call at request time, cached per item like E-6. Grammar rules get a
// rule explanation + meaning-first exercises; lemmas get an intro (meaning + a
// correct colto example) + recognition→production exercises. The money spine is
// E-6's exactly — reserve-before-call, finalize to actual, a parse failure still
// ledgers the resolved call — reused, never re-forked (lib/lessons/billing.ts).
//
// Every exercise is MEANING-FIRST: an English instruction/gloss or an Italian
// context gap, never an error form (D-18). The retrieval target is always the
// correct form. Colto register (D-23) is injected into the prompt. The pure prompt
// builders and the response parser are exported for direct fixture tests — no CI
// test ever makes a real call (there is no key in the sandbox).

/** Output-token allowance for an item-lesson — bounds the worst-case pre-call cost. */
export const ITEM_LESSON_MAX_OUTPUT_TOKENS = 1400;

/** English display names for the POS scheme — for the vocab prompt and labels only. */
const POS_LABEL: Record<Pos, string> = {
  NOUN: "noun", PROPN: "proper noun", VERB: "verb", AUX: "auxiliary verb",
  ADJ: "adjective", ADV: "adverb", PRON: "pronoun", DET: "determiner",
  ADP: "preposition", CCONJ: "conjunction", INTJ: "interjection",
};

export function posLabel(pos: Pos | null): string {
  return pos ? POS_LABEL[pos] : "word";
}

/** The register guidance injected into every prompt (E-33, D-23). Now the shared
 *  dial instruction (lib/register.ts) — one source for recasts, lessons, TTS, tutor. */
function registerLine(register: string): string {
  return registerInstruction(coerceRegister(register));
}

// ── prompts ──────────────────────────────────────────────────────────────────

const SHARED_RULES = [
  `Respond with JSON ONLY, no prose. Every exercise is MEANING-FIRST: the "prompt" is an English instruction/gloss or an Italian sentence with a gap written "____".`,
  `NEVER put an incorrect or error form in a "prompt" — the cue is never the wrong answer. The correct form is always the retrieval target.`,
  `Each exercise carries the correct "answer" and a one-sentence "rationale" explaining why it is correct.`,
  `Use "type":"multiple_choice" with "options" (2+) and 0-based "answerIndex" (its option must equal "answer"), or "type":"cloze" (a gapped sentence; "answer" fills the gap) with a boolean "derivable" (is the answer inferable from the surrounding context?).`,
  `Include ${MIN_ITEM_EXERCISES}-5 exercises mixing both types.`,
];

/** Build the grammar-lesson prompt for a syllabus rule, colto-aware (D-23). */
export function grammarLessonPrompt(targetLanguage: string, register: string, rule: SyllabusRule): string {
  return [
    `You are an expert ${targetLanguage} coach writing a short grammar micro-lesson for an advanced learner.`,
    registerLine(register),
    `Teach this rule (${rule.cefr}): "${rule.title}". ${rule.description}`,
    `Correct examples of the rule: ${rule.examples.join("; ")}.`,
    "",
    'Shape exactly: {"intro": string, "exercises": [ ... ]}',
    "The intro is a 2-4 sentence explanation of the rule.",
    ...SHARED_RULES,
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
    `You are an expert ${targetLanguage} coach writing a short vocabulary micro-lesson for an advanced learner.`,
    registerLine(register),
    `Teach the ${targetLanguage} ${posLabel(pos)} "${lemma}".`,
    "",
    'Shape exactly: {"intro": string, "glossEn": string, "exercises": [ ... ]}',
    `The intro gives the meaning and ONE correct ${targetLanguage} example sentence in register. "glossEn" is a short English gloss of "${lemma}".`,
    "Order exercises recognition first, then production.",
    ...SHARED_RULES,
  ].join("\n");
}

// ── parsing ────────────────────────────────────────────────────────────────

function asString(v: unknown, ctx: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new TextModelParseError(`${ctx} must be a non-empty string.`);
  return v.trim();
}

/** Validate one exercise object into a typed `ItemExercise`; any defect rejects it. */
function parseExercise(raw: unknown, i: number): ItemExercise {
  if (typeof raw !== "object" || raw === null) throw new TextModelParseError(`Exercise ${i} is not an object.`);
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !(ITEM_EXERCISE_TYPES as readonly string[]).includes(e.type)) {
    throw new TextModelParseError(`Exercise ${i} has an invalid \`type\`.`);
  }
  const prompt = asString(e.prompt, `Exercise ${i} prompt`);
  const answer = asString(e.answer, `Exercise ${i} answer`);
  const rationale = asString(e.rationale, `Exercise ${i} rationale`);
  const gloss = e.gloss === undefined || e.gloss === null ? undefined : asString(e.gloss, `Exercise ${i} gloss`);

  if (e.type === "multiple_choice") {
    if (!Array.isArray(e.options) || e.options.length < 2) {
      throw new TextModelParseError(`Exercise ${i} needs an options array of 2+.`);
    }
    const options = e.options.map((o, j) => asString(o, `Exercise ${i} option ${j}`));
    if (typeof e.answerIndex !== "number" || !Number.isInteger(e.answerIndex) || e.answerIndex < 0 || e.answerIndex >= options.length) {
      throw new TextModelParseError(`Exercise ${i} has an out-of-range \`answerIndex\`.`);
    }
    if (options[e.answerIndex] !== answer) {
      throw new TextModelParseError(`Exercise ${i} answer must equal the option at answerIndex.`);
    }
    return { type: "multiple_choice", prompt, options, answerIndex: e.answerIndex, answer, rationale, ...(gloss ? { gloss } : {}) };
  }
  // cloze
  const derivable = typeof e.derivable === "boolean" ? e.derivable : undefined;
  return { type: "cloze", prompt, answer, rationale, ...(derivable !== undefined ? { derivable } : {}), ...(gloss ? { gloss } : {}) };
}

/**
 * Parse a model reply into a validated `NewItemLesson` for `item`. Any malformed or
 * partial exercise rejects the WHOLE response with a truthful error (nothing is
 * persisted). For vocab lessons the [P4] gloss-fallback runs after validation, so a
 * degraded cloze is stored already answerable. Tolerates fenced/prose JSON.
 */
export function parseItemLessonResponse(
  item: { id: string; kind: ItemLessonKind },
  register: string,
  raw: string,
): NewItemLesson {
  const obj = extractJsonObject(raw);
  const intro = asString(obj.intro, "Lesson intro");
  if (!Array.isArray(obj.exercises) || obj.exercises.length < MIN_ITEM_EXERCISES) {
    throw new TextModelParseError(`Lesson needs at least ${MIN_ITEM_EXERCISES} exercises.`);
  }
  const exercises = obj.exercises.map((e, i) => parseExercise(e, i));
  const glossEn = item.kind === "vocab" ? asString(obj.glossEn, "Lesson glossEn") : null;
  const lesson: NewItemLesson = { itemId: item.id, kind: item.kind, register, intro, glossEn, exercises };
  return applyGlossFallback(lesson);
}

// ── store ────────────────────────────────────────────────────────────────────

interface ItemLessonRow {
  item_id: string;
  kind: ItemLessonKind;
  register: string;
  body: string;
  created_at: string;
}

/** The cached lesson for a knowledge item, or null if none has been generated. */
export function getItemLesson(db: Db, itemId: string): ItemLesson | null {
  const r = db.prepare("SELECT * FROM item_lessons WHERE item_id = ?").get(itemId) as ItemLessonRow | undefined;
  if (!r) return null;
  const body = JSON.parse(r.body) as { intro: string; glossEn: string | null; exercises: ItemExercise[] };
  return { itemId: r.item_id, kind: r.kind, register: r.register, intro: body.intro, glossEn: body.glossEn, exercises: body.exercises };
}

/** Insert a generated lesson and return it. `run` may pass a transaction so the
 *  insert commits atomically with its spend-ledger row. The `item_id` PK makes a
 *  concurrent double-generate a truthful failure, never a silent duplicate. */
export function insertItemLesson(db: Db, lesson: NewItemLesson): ItemLesson {
  db.prepare("INSERT INTO item_lessons (item_id, kind, register, body) VALUES (?, ?, ?, ?)").run(
    lesson.itemId,
    lesson.kind,
    lesson.register,
    JSON.stringify({ intro: lesson.intro, glossEn: lesson.glossEn, exercises: lesson.exercises }),
  );
  return getItemLesson(db, lesson.itemId)!;
}

// ── generation (money-capped, cached) ─────────────────────────────────────────

/** The lesson kind a knowledge item maps to, or null for a kind E-32 does not cover
 *  (phones are pronunciation → E-37, out of scope). */
export function itemLessonKind(itemId: string): ItemLessonKind | null {
  const kind = parseItemId(itemId).kind;
  return kind === "rule" ? "grammar" : kind === "lemma" ? "vocab" : null;
}

/** The syllabus rule an id names, or null. */
function ruleOf(itemId: string): SyllabusRule | null {
  const key = itemId.slice("rule:".length);
  return loadSyllabus().rules.find((r) => r.key === key) ?? null;
}

/** Build the generation prompt for an item (grammar or vocab), colto-aware. */
export function itemLessonPrompt(db: Db, itemId: string, register: string): string {
  const { targetLanguage } = readSettings(db);
  const kind = itemLessonKind(itemId);
  if (kind === "grammar") {
    const rule = ruleOf(itemId);
    if (!rule) throw new Error(`No syllabus rule for ${itemId}.`);
    return grammarLessonPrompt(targetLanguage, register, rule);
  }
  if (kind === "vocab") {
    const { lemma, pos } = parseItemId(itemId);
    return vocabLessonPrompt(targetLanguage, register, lemma ?? "", pos);
  }
  throw new Error(`E-32 does not generate a lesson for ${itemId}.`);
}

/** The register lesson generation writes in — the E-33 dial from Settings (D-23). */
export function lessonRegister(db: Db): Register {
  return coerceRegister(readSettings(db).register);
}

/** Worst-case USD to generate an item's lesson — the SAME upper bound the cap
 *  checks before the real call (display only, no model call, no write). Uses the
 *  live register so the estimate is built from the prompt the call will send. */
export function itemLessonEstimateUsd(db: Db, itemId: string): number {
  const prompt = itemLessonPrompt(db, itemId, lessonRegister(db));
  return textCallCost(TEXT_MODEL, estimateTokens(prompt), ITEM_LESSON_MAX_OUTPUT_TOKENS);
}

/**
 * Generate (or return the cached) lesson for a composer-chosen item. A cache hit
 * makes ZERO model calls and records nothing (WO criterion 3). Otherwise: reserve
 * before the call → one model call → parse (a malformed reply STILL ledgers the
 * resolved call, E-16 defect 4) → persist the lesson and finalize its spend in ONE
 * transaction. Throws `BudgetExceededError` before any call if the cap would be
 * breached, or `TextModelParseError` on a malformed reply (no persist).
 */
export async function generateItemLesson(
  db: Db,
  client: TextModelClient,
  itemId: string,
): Promise<{ lesson: ItemLesson; cached: boolean }> {
  const existing = getItemLesson(db, itemId);
  if (existing) return { lesson: existing, cached: true };

  const kind = itemLessonKind(itemId);
  if (!kind) throw new Error(`E-32 does not generate a lesson for ${itemId}.`);
  const register = lessonRegister(db);
  const prompt = itemLessonPrompt(db, itemId, register);
  const { completion, costUsd, reservation } = await runBilledTextCall(db, client, {
    prompt,
    maxOutputTokens: ITEM_LESSON_MAX_OUTPUT_TOKENS,
    contentHash: `item-lesson:${itemId}`,
  });
  const parsed = parseBilledResponse(db, { reservation, costUsd }, () =>
    parseItemLessonResponse({ id: itemId, kind }, register, completion.text),
  );
  const lesson = db.transaction(() => {
    finalizeReservation(db, reservation, costUsd);
    return insertItemLesson(db, parsed);
  })();
  return { lesson, cached: false };
}
