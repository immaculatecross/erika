import type { Db } from "../db";
import { readSettings } from "../settings";
import { coerceRegister, type Register } from "../register";
import { finalizeReservation } from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import { parseItemId } from "../knowledge/items";
import { loadSyllabus, type SyllabusRule } from "../syllabus";
import { TextModelParseError, TextModelTruncatedError, wasTruncated, type TextModelClient } from "./text-model";
import { runBilledTextCall } from "./billing";
import { lessonOutputTokenCeiling, lessonRepairTokenCeiling } from "./lesson-budget";
import { deterministicLessonFor, ruleDrills } from "./syllabus-lesson";
import {
  BREVITY_RETRY_INSTRUCTION,
  grammarLessonPrompt as grammarPrompt,
  parseItemLessonResponse,
  vocabLessonPrompt as vocabPrompt,
} from "./lesson-parse";
import {
  usableDrills,
  type ItemExercise,
  type ItemLesson,
  type ItemLessonKind,
  type LessonWord,
  type NewItemLesson,
} from "./item-lessons-view";

// Lesson generation for ONE composer-chosen knowledge item, cached per item and
// paid for through the shared money spine (reserve-before-call, finalize to actual,
// a parse failure still ledgers the resolved call — lib/lessons/billing.ts). The
// prompts and the parser live in ./lesson-parse; this module is the money, the
// lease, and the guarantee.
//
// ── THE GUARANTEE (E-45) ─────────────────────────────────────────────────────
//
//   A billed generation either produces a usable lesson, or it is not presented
//   as one — and either way the learner gets a lesson.
//
// It did not hold. A live probe found a call that resolved, was billed, and left
// the learner with "the lesson model returned an unreadable response": the reply
// had been CUT OFF at the token ceiling, so it was half a JSON object. Three
// things were wrong at once and all three are fixed here:
//
//   1. the ceiling was a picked number, not one derived from what the prompt asks
//      for — it is now `lessonOutputTokenCeiling()`, computed from the content
//      budget and checked against live measurement;
//   2. truncation was invisible, because the client discarded `finish_reason` — it
//      now raises `TextModelTruncatedError`, which is a different fact from "that
//      was unreadable" and, unlike it, is something a model can act on;
//   3. there was no repair. There is now ONE bounded retry (E-16's pattern) that
//      asks for the minimum lesson with more room, and if that also fails the
//      caller falls back to the deterministic syllabus lesson.
//
// `todaysLesson` is the seam every caller should use: it cannot fail.

// Re-exported so existing importers of this module keep one import site.
export { grammarLessonPrompt, vocabLessonPrompt, parseItemLessonResponse, posLabel } from "./lesson-parse";

/** Output-token allowance for an item-lesson — DERIVED from the content budget
 *  (lib/lessons/lesson-budget.ts) rather than picked, and checked against live
 *  measurement. See `lessonOutputTokenCeiling` for the arithmetic and the numbers. */
export const ITEM_LESSON_MAX_OUTPUT_TOKENS = lessonOutputTokenCeiling();

// ── store ────────────────────────────────────────────────────────────────────

interface ItemLessonRow {
  item_id: string;
  kind: ItemLessonKind;
  register: string;
  body: string;
  created_at: string;
}

interface StoredBody {
  intro: string;
  glossEn: string | null;
  exercises: ItemExercise[];
  examples?: string[];
  newWords?: LessonWord[];
}

/**
 * The COMPLETED cached lesson for a knowledge item, or null. A lesson is complete
 * once its winning call has written the `body` (`body <> ''`); a bare CLAIM row —
 * inserted before the call and still empty ([T1] lease-before-call) — is
 * deliberately NOT returned, so an in-flight claim never reads as a cache hit.
 *
 * [E-45] Stored exercises pass through `usableDrills` on the way out. A body
 * written before the format change holds typed `cloze` exercises with no options,
 * which the runner cannot render; dropping them here is what lets the format change
 * WITHOUT a migration and without re-billing — `todaysLesson` tops the lesson back
 * up from the deterministic syllabus drills, so the learner keeps the explanation
 * they already paid for and gets working drills with it.
 */
export function getItemLesson(db: Db, itemId: string): ItemLesson | null {
  const r = db
    .prepare("SELECT * FROM item_lessons WHERE item_id = ? AND body <> ''")
    .get(itemId) as ItemLessonRow | undefined;
  if (!r) return null;
  const body = JSON.parse(r.body) as StoredBody;
  return {
    itemId: r.item_id,
    kind: r.kind,
    register: r.register,
    intro: body.intro,
    examples: body.examples ?? [],
    newWords: body.newWords ?? [],
    glossEn: body.glossEn,
    exercises: usableDrills(body.exercises ?? []),
  };
}

/**
 * Claim the `item_id` row idempotently — the item-lesson lease ([T1], mirroring
 * `claimNote`). Inserts a BARE claim (empty `body`) and returns whether THIS call
 * inserted it: `true` = we won (proceed to the one budgeted call), `false` = a
 * concurrent generate claimed it first, so make NO model call and bill nothing.
 * `ON CONFLICT(item_id) DO NOTHING` on the PK makes the claim exclusive, and
 * better-sqlite3 runs statements serially, so at most one call and one ledger row
 * ever result. The engine claims BEFORE it spends.
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
 * Complete a won claim: write the generated lesson body. Called only by the request
 * that won the claim, only after a successful call, inside the same transaction
 * that finalizes the spend — so a lesson is never stored without its charge nor
 * charged without being stored.
 */
export function completeItemLesson(db: Db, lesson: NewItemLesson): ItemLesson {
  const body: StoredBody = {
    intro: lesson.intro,
    glossEn: lesson.glossEn,
    exercises: lesson.exercises,
    examples: lesson.examples,
    newWords: lesson.newWords,
  };
  db.prepare("UPDATE item_lessons SET kind = ?, register = ?, body = ? WHERE item_id = ?").run(
    lesson.kind,
    lesson.register,
    JSON.stringify(body),
    lesson.itemId,
  );
  return getItemLesson(db, lesson.itemId)!;
}

/**
 * Release a claim: delete the bare `item_id` row. Called only on the engine's OWN
 * uncommitted claim when generation does not complete, so a legitimate retry can
 * re-lease. Only ever deletes an EMPTY claim, so a completed lesson is safe.
 */
export function releaseItemLesson(db: Db, itemId: string): void {
  db.prepare("DELETE FROM item_lessons WHERE item_id = ? AND body = ''").run(itemId);
}

// ── generation (money-capped, cached) ─────────────────────────────────────────

/** The lesson kind a knowledge item maps to, or null for a kind with no lesson
 *  format (phones are pronunciation → the studio, E-37). */
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
    return grammarPrompt(targetLanguage, register, rule);
  }
  if (kind === "vocab") {
    const { lemma, pos } = parseItemId(itemId);
    return vocabPrompt(targetLanguage, register, lemma ?? "", pos);
  }
  throw new Error(`There is no lesson format for ${itemId}.`);
}

/** The register lesson generation writes in — the E-33 dial from Settings (D-23). */
export function lessonRegister(db: Db): Register {
  return coerceRegister(readSettings(db).register);
}

/** Worst-case USD to generate an item's lesson — the SAME upper bound the cap
 *  checks before the real call (display only, no model call, no write). */
export function itemLessonEstimateUsd(db: Db, itemId: string): number {
  const prompt = itemLessonPrompt(db, itemId, lessonRegister(db));
  return textCallCost(TEXT_MODEL, estimateTokens(prompt), ITEM_LESSON_MAX_OUTPUT_TOKENS);
}

/** The deterministic syllabus drills for an item — the top-up source and the
 *  fallback lesson's own drills. Empty for a lemma: there is no offline
 *  Italian→English gloss source, so a vocabulary lesson genuinely needs a model. */
function fallbackDrillsFor(itemId: string): ItemExercise[] {
  const rule = itemLessonKind(itemId) === "grammar" ? ruleOf(itemId) : null;
  return rule ? ruleDrills(rule) : [];
}

/**
 * Generate (or return the cached) lesson for a composer-chosen item. A cache hit
 * makes ZERO model calls and records nothing.
 *
 * [T1 — money, never-waivable] Ordering is LEASE-BEFORE-CALL: `claimItemLesson`
 * inserts the PK row FIRST, before the budget check and before `client.complete()`.
 * The claim is exclusive, so exactly one racing request reaches the provider and
 * bills; every loser returns without a model call and without a ledger row.
 *
 * The winner reserves before the call, then parses (a malformed reply STILL ledgers
 * the resolved call, E-16 defect 4), then completes the lesson and finalizes its
 * spend in ONE transaction. Any handled failure before completion RELEASES the
 * claim so a legitimate retry can re-lease.
 */
export async function generateItemLesson(
  db: Db,
  client: TextModelClient,
  itemId: string,
): Promise<{ lesson: ItemLesson | null; cached: boolean }> {
  const existing = getItemLesson(db, itemId);
  if (existing) return { lesson: existing, cached: true };

  const kind = itemLessonKind(itemId);
  if (!kind) throw new Error(`There is no lesson format for ${itemId}.`);
  const register = lessonRegister(db);

  const won = claimItemLesson(db, { itemId, kind, register });
  if (!won) return { lesson: getItemLesson(db, itemId), cached: true };

  try {
    const lesson = await callWithBrevityRepair(db, client, {
      itemId,
      kind,
      register,
      basePrompt: itemLessonPrompt(db, itemId, register),
      fallback: fallbackDrillsFor(itemId),
    });
    return { lesson, cached: false };
  } catch (err) {
    releaseItemLesson(db, itemId);
    throw err;
  }
}

/**
 * One call, and — only if it came back TRUNCATED — one bounded repair (E-16's
 * pattern). The repair asks for the minimum lesson and is given more room, so both
 * levers move the same way.
 *
 * Each attempt is independently reserved, billed and finalized, because it IS a
 * separate call: folding two calls into one charge would understate spend, which
 * this repo treats as a never-waivable defect. If the repair also truncates the
 * error is `TextModelTruncatedError` — truthful, and distinguishable by the caller
 * from "unreadable", which is what lets `todaysLesson` answer with the syllabus
 * lesson instead of an error screen.
 */
async function callWithBrevityRepair(
  db: Db,
  client: TextModelClient,
  input: {
    itemId: string;
    kind: ItemLessonKind;
    register: string;
    basePrompt: string;
    fallback: readonly ItemExercise[];
  },
): Promise<ItemLesson> {
  const attempts = [
    { prompt: input.basePrompt, ceiling: ITEM_LESSON_MAX_OUTPUT_TOKENS, hash: `item-lesson:${input.itemId}` },
    {
      prompt: `${input.basePrompt}\n\n${BREVITY_RETRY_INSTRUCTION}`,
      ceiling: lessonRepairTokenCeiling(),
      hash: `item-lesson-repair:${input.itemId}`,
    },
  ];

  let truncation: TextModelTruncatedError | null = null;
  for (const attempt of attempts) {
    const { completion, costUsd, reservation } = await runBilledTextCall(db, client, {
      prompt: attempt.prompt,
      maxOutputTokens: attempt.ceiling,
      contentHash: attempt.hash,
    });

    // The call resolved, so it was billed. Every branch finalizes FIRST — never
    // understate spend precisely when things are going wrong (E-16 defect 4).
    if (wasTruncated(completion)) {
      finalizeReservation(db, reservation, costUsd);
      truncation = new TextModelTruncatedError(`The lesson reply was cut off at ${attempt.ceiling} tokens.`);
      continue;
    }

    let parsed: NewItemLesson;
    try {
      parsed = parseItemLessonResponse(
        { id: input.itemId, kind: input.kind },
        input.register,
        completion.text,
        input.fallback,
      );
    } catch (err) {
      finalizeReservation(db, reservation, costUsd);
      throw err;
    }

    return db.transaction(() => {
      finalizeReservation(db, reservation, costUsd);
      return completeItemLesson(db, parsed);
    })();
  }
  throw truncation ?? new TextModelParseError("The lesson could not be generated.");
}

/**
 * TODAY'S LESSON — the seam E-44's session asks for, and the one that CANNOT FAIL.
 *
 * Order: the cached lesson, then a generated one if a client is offered and the
 * budget allows, then the deterministic syllabus lesson. Every failure of the
 * middle step — no key, budget refused, network down, unreadable reply, a reply
 * truncated twice — lands on the syllabus lesson rather than on a wall, because
 * D-27 makes the syllabus the backbone and not the consolation prize.
 *
 * Pass `client: null` to stay entirely offline, which is what a keyless install
 * does and what the empty-database test drives.
 */
export async function todaysLesson(
  db: Db,
  client: TextModelClient | null,
  itemId: string,
): Promise<ItemLesson | null> {
  const deterministic = deterministicLessonFor(itemId, lessonRegister(db));

  const cached = getItemLesson(db, itemId);
  if (cached) return withDrills(cached, deterministic);

  if (client) {
    try {
      const { lesson } = await generateItemLesson(db, client, itemId);
      if (lesson) return withDrills(lesson, deterministic);
    } catch {
      // Budget, network, parse, truncation — one answer to the learner: here is
      // your lesson. The failure is in the ledger and the server log, never on the
      // screen as a dead end (D-26: no route may end at a wall).
    }
  }
  return deterministic;
}

/** Top a lesson up from the deterministic drills when it has none of its own —
 *  what rescues a legacy stored body whose typed exercises were dropped on read. */
function withDrills(lesson: ItemLesson, deterministic: ItemLesson | null): ItemLesson {
  if (lesson.exercises.length > 0 || !deterministic) return lesson;
  return { ...lesson, exercises: deterministic.exercises };
}
