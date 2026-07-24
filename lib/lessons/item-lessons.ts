import type { Db } from "../db";
import { readSettings } from "../settings";
import { registerInstruction, coerceRegister, type Register } from "../register";
import { finalizeReservation } from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import { parseItemId } from "../knowledge/items";
import { loadSyllabus, type SyllabusRule } from "../syllabus";
import type { Pos } from "../lexicon/pos";
import { extractJsonObject, TextModelParseError, type TextModelClient } from "./text-model";
import { runBilledTextCall } from "./billing";
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

/**
 * The COMPLETED cached lesson for a knowledge item, or null. A lesson is complete
 * once its winning call has written the `body` (`body <> ''`); a bare CLAIM row —
 * inserted before the call and still empty ([T1] lease-before-call, the ask_notes
 * pattern) — is deliberately NOT returned, so an in-flight claim never reads as a
 * cache hit and never blocks the re-open path from re-leasing after a released
 * failure.
 */
export function getItemLesson(db: Db, itemId: string): ItemLesson | null {
  const r = db
    .prepare("SELECT * FROM item_lessons WHERE item_id = ? AND body <> ''")
    .get(itemId) as ItemLessonRow | undefined;
  if (!r) return null;
  const body = JSON.parse(r.body) as { intro: string; glossEn: string | null; exercises: ItemExercise[] };
  return { itemId: r.item_id, kind: r.kind, register: r.register, intro: body.intro, glossEn: body.glossEn, exercises: body.exercises };
}

/**
 * Claim the `item_id` row idempotently — this is the item-lesson lease ([T1],
 * mirroring `claimNote`). Inserts a BARE claim (empty `body`, the kind + register
 * known before the call) and returns whether THIS call inserted it: `true` = we won
 * the claim (proceed to the one budgeted model call, then `completeItemLesson`),
 * `false` = a row already existed (a concurrent generate claimed it first — make NO
 * model call and bill nothing). `ON CONFLICT(item_id) DO NOTHING` on the PK makes
 * the claim exclusive; because better-sqlite3 runs statements serially on the
 * connection, two racing generates can never both win the row, so at most one model
 * call and one ledger row ever result. The engine claims BEFORE it spends.
 */
export function claimItemLesson(
  db: Db,
  entry: { itemId: string; kind: ItemLessonKind; register: string },
): boolean {
  const info = db
    .prepare(
      "INSERT INTO item_lessons (item_id, kind, register, body) VALUES (?, ?, ?, '') ON CONFLICT(item_id) DO NOTHING",
    )
    .run(entry.itemId, entry.kind, entry.register);
  return info.changes > 0;
}

/**
 * Complete a won claim: write the generated lesson body (and confirm its kind /
 * register). Called only by the request that won the claim, only after a successful
 * model call, inside the same transaction that finalizes the spend — so a lesson is
 * never stored without its charge nor charged without being stored. Returns the
 * completed lesson.
 */
export function completeItemLesson(db: Db, lesson: NewItemLesson): ItemLesson {
  db.prepare("UPDATE item_lessons SET kind = ?, register = ?, body = ? WHERE item_id = ?").run(
    lesson.kind,
    lesson.register,
    JSON.stringify({ intro: lesson.intro, glossEn: lesson.glossEn, exercises: lesson.exercises }),
    lesson.itemId,
  );
  return getItemLesson(db, lesson.itemId)!;
}

/**
 * Release a claim: delete the bare `item_id` row. The engine calls this only on its
 * OWN uncommitted claim when generation does not complete (budget refusal or a
 * failed/unreadable call), so a legitimate retry can re-claim and generate — a
 * claimed row is never a permanent tombstone. Only ever deletes an EMPTY claim, so a
 * completed lesson can never be dropped by this path.
 */
export function releaseItemLesson(db: Db, itemId: string): void {
  db.prepare("DELETE FROM item_lessons WHERE item_id = ? AND body = ''").run(itemId);
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
 * makes ZERO model calls and records nothing (WO criterion 3).
 *
 * [T1 — money, never-waivable] Ordering is LEASE-BEFORE-CALL, adopting the sibling
 * ask_notes pattern: `claimItemLesson` inserts the `item_id` PK row FIRST — before
 * the budget check and before `client.complete()`. The claim is exclusive (PK +
 * serialized statements), so exactly one racing request reaches the provider and
 * bills; every racing LOSER detects the claim and returns WITHOUT a model call and
 * WITHOUT a ledger row (`lesson: <completed or null>, cached: true`). Previously the
 * call fired before the insert, so two concurrent same-item opens BOTH called and
 * were BOTH charged — but the loser's PK conflict rolled back its `finalizeReservation`,
 * leaving its real charge as a pending row the sweep swept to $0 (recorded spend ≠
 * actual spend, D-15).
 *
 * The winner: reserve before the call → one model call → parse (a malformed reply
 * STILL ledgers the resolved call, E-16 defect 4) → complete the lesson and finalize
 * its spend in ONE transaction. Any handled failure before completion RELEASES the
 * claim so a legitimate retry can re-lease. Throws `BudgetExceededError` before any
 * call if the cap would be breached, or `TextModelParseError` on a malformed reply
 * (no lesson persisted).
 */
export async function generateItemLesson(
  db: Db,
  client: TextModelClient,
  itemId: string,
): Promise<{ lesson: ItemLesson | null; cached: boolean }> {
  const existing = getItemLesson(db, itemId);
  if (existing) return { lesson: existing, cached: true };

  const kind = itemLessonKind(itemId);
  if (!kind) throw new Error(`E-32 does not generate a lesson for ${itemId}.`);
  const register = lessonRegister(db);

  // LEASE FIRST: claim the item_lessons row before reserving and before the model
  // call. If we lose the claim, a concurrent generate already holds it — make NO
  // call and bill nothing; hand back the completed lesson if it is ready yet.
  const won = claimItemLesson(db, { itemId, kind, register });
  if (!won) return { lesson: getItemLesson(db, itemId), cached: true };

  const prompt = itemLessonPrompt(db, itemId, register);
  let billed;
  try {
    billed = await runBilledTextCall(db, client, {
      prompt,
      maxOutputTokens: ITEM_LESSON_MAX_OUTPUT_TOKENS,
      contentHash: `item-lesson:${itemId}`,
    });
  } catch (err) {
    // Budget refusal (before any call) or a failed call (nothing billed): release the
    // claim so a retry can re-lease. `runBilledTextCall` already released any reservation.
    releaseItemLesson(db, itemId);
    throw err;
  }

  const { completion, costUsd, reservation } = billed;
  let parsed;
  try {
    parsed = parseItemLessonResponse({ id: itemId, kind }, register, completion.text);
  } catch (err) {
    // Billed but unreadable: finalize the reservation to the ACTUAL charge (never
    // understate spend, E-16 defect 4) THEN release the empty claim so no half-lesson
    // persists. A retry is a new, separately-billed call.
    finalizeReservation(db, reservation, costUsd);
    releaseItemLesson(db, itemId);
    throw err;
  }

  const lesson = db.transaction(() => {
    finalizeReservation(db, reservation, costUsd);
    return completeItemLesson(db, parsed);
  })();
  return { lesson, cached: false };
}
