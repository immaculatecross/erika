import type { Db } from "../db";
import { readSettings } from "../settings";
import { coerceRegister, type Register } from "../register";
import { finalizeReservation } from "../analysis/budget";
import { TEXT_MODEL, estimateTokens, textCallCost } from "../analysis/rates";
import { parseItemId } from "../knowledge/items";
import { currentPlacementRun } from "../knowledge/placement-runs";
import { collectSpeakerProfile } from "../analysis/profile";
import { isCefrLevel, loadSyllabus, type CefrLevel, type SyllabusRule } from "../syllabus";
import { TextModelParseError, TextModelTruncatedError, wasTruncated, type TextModelClient } from "./text-model";
import { runBilledTextCall } from "./billing";
import { lessonOutputTokenCeiling, lessonRepairTokenCeiling } from "./lesson-budget";
import { buildRuleLesson, deterministicLessonFor, ruleDrills, ruleIsTeachable } from "./syllabus-lesson";
import {
  BREVITY_RETRY_INSTRUCTION,
  ITALIAN_REPAIR_INSTRUCTION,
  grammarLessonPrompt as grammarPrompt,
  parseItemLessonResponse,
  vocabLessonPrompt as vocabPrompt,
} from "./lesson-parse";
import { assertItalianLesson, ItalianLessonLanguageError } from "./italian-language";
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
/** Contract version 2 is target-language-only (E-47). Version-1 English cache rows
 * are deleted by v31 and excluded structurally on every read. */
export const ITEM_LESSON_CONTENT_VERSION = 2;

// ── store ────────────────────────────────────────────────────────────────────

interface ItemLessonRow {
  item_id: string;
  kind: ItemLessonKind;
  register: string;
  body: string;
  content_version: number;
  created_at: string;
}

interface StoredBody {
  itemId: string;
  intro: string;
  definition: string | null;
  exercises: ItemExercise[];
  examples?: string[];
  newWords?: LessonWord[];
  deterministic?: boolean;
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
    .prepare("SELECT * FROM item_lessons WHERE item_id = ? AND body <> '' AND content_version = ?")
    .get(itemId, ITEM_LESSON_CONTENT_VERSION) as ItemLessonRow | undefined;
  if (!r) return null;
  const body = JSON.parse(r.body) as StoredBody;
  return {
    itemId: body.itemId,
    kind: r.kind,
    register: r.register,
    intro: body.intro,
    examples: body.examples ?? [],
    newWords: body.newWords ?? [],
    definition: body.definition,
    exercises: usableDrills(body.exercises ?? []),
    ...(body.deterministic ? { deterministic: true } : {}),
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
  return db.transaction(() => {
    // Defence in depth after v31: an obsolete row manually restored from backup
    // cannot block a v2 claim or be mistaken for an in-flight preparation.
    db.prepare("DELETE FROM item_lessons WHERE item_id = ? AND content_version <> ?")
      .run(entry.itemId, ITEM_LESSON_CONTENT_VERSION);
    const info = db
      .prepare(
        "INSERT INTO item_lessons (item_id, kind, register, body, content_version) VALUES (?, ?, ?, '', ?) ON CONFLICT(item_id) DO NOTHING",
      )
      .run(entry.itemId, entry.kind, entry.register, ITEM_LESSON_CONTENT_VERSION);
    return info.changes > 0;
  })();
}

/**
 * Complete a won claim: write the generated lesson body. Called only by the request
 * that won the claim, only after a successful call, inside the same transaction
 * that finalizes the spend — so a lesson is never stored without its charge nor
 * charged without being stored.
 */
export function completeItemLesson(db: Db, lesson: NewItemLesson, cacheKey: string = lesson.itemId): ItemLesson {
  assertItalianLesson(lesson);
  const body: StoredBody = {
    itemId: lesson.itemId,
    intro: lesson.intro,
    definition: lesson.definition,
    exercises: lesson.exercises,
    examples: lesson.examples,
    newWords: lesson.newWords,
    deterministic: lesson.deterministic,
  };
  db.prepare("UPDATE item_lessons SET kind = ?, register = ?, body = ? WHERE item_id = ? AND content_version = ?").run(
    lesson.kind,
    lesson.register,
    JSON.stringify(body),
    cacheKey,
    ITEM_LESSON_CONTENT_VERSION,
  );
  return getItemLesson(db, cacheKey)!;
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
  // The E-19 speaker profile is the D-27 overlay: the syllabus chooses the rule,
  // the learner's own recorded patterns choose the angle. Absent (a fresh database)
  // it simply is not in the prompt.
  const profile = collectSpeakerProfile(db);
  if (kind === "grammar") {
    const rule = ruleOf(itemId);
    if (!rule) throw new Error(`No syllabus rule for ${itemId}.`);
    return grammarPrompt(targetLanguage, register, rule, profile);
  }
  if (kind === "vocab") {
    const { lemma, pos } = parseItemId(itemId);
    return vocabPrompt(targetLanguage, register, lemma ?? "", pos, profile);
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
 *  definition source, so a vocabulary lesson genuinely needs a model. */
function fallbackDrillsFor(itemId: string): ItemExercise[] {
  const rule = itemLessonKind(itemId) === "grammar" ? ruleOf(itemId) : null;
  return rule ? ruleDrills(rule) : [];
}

/** The learner's current CEFR edge, used only for an offline vocabulary
 * substitution. A fresh/unplaced database begins at A1; a recorded placement is
 * authoritative after that. */
export function learnerCefrEdge(db: Db): CefrLevel {
  const level = currentPlacementRun(db)?.level;
  return isCefrLevel(level) ? level : "A1";
}

/**
 * The authored Italian lesson that can be prepared without a provider call.
 *
 * Rules use their own deterministic lesson (or the same-band substitution for the
 * 44 rules whose examples cannot make fair drills). Vocabulary has no
 * license-clean definition source, so it substitutes a complete grammar lesson at
 * the learner's CEFR edge. The returned lesson carries the rule actually taught;
 * the cache key remains the composer-selected item.
 */
export function authoredLessonFor(db: Db, itemId: string, register: string = lessonRegister(db)): ItemLesson {
  const ruleLesson = deterministicLessonFor(itemId, register);
  if (ruleLesson) return ruleLesson;

  if (itemLessonKind(itemId) === "vocab") {
    const edge = learnerCefrEdge(db);
    const rules = loadSyllabus().rules;
    const substitute =
      rules.find((rule) => rule.cefr === edge && ruleIsTeachable(rule)) ??
      rules.find(ruleIsTeachable);
    const lesson = substitute ? buildRuleLesson(substitute, register) : null;
    if (lesson) return lesson;
  }
  throw new Error(`No authored lesson is available for ${itemId}.`);
}

export type LessonPreparationState = "needed" | "preparing" | "ready";

/** A crashed preparation must not leave an empty claim forever. Fifteen minutes
 * mirrors the shared spend reservation TTL and is far longer than one bounded text
 * call. Completed cache bodies are never touched. */
export const ITEM_LESSON_CLAIM_STALE_SECONDS = 15 * 60;

export function sweepStaleItemLessonClaims(db: Db): number {
  return db
    .prepare(
      "DELETE FROM item_lessons WHERE body = '' AND content_version = ? " +
        "AND created_at <= datetime('now', ?)",
    )
    .run(ITEM_LESSON_CONTENT_VERSION, `-${ITEM_LESSON_CLAIM_STALE_SECONDS} seconds`).changes;
}

export function lessonPreparationState(db: Db, itemId: string): LessonPreparationState {
  if (getItemLesson(db, itemId)) return "ready";
  const claim = db
    .prepare("SELECT 1 FROM item_lessons WHERE item_id = ? AND body = '' AND content_version = ?")
    .get(itemId, ITEM_LESSON_CONTENT_VERSION);
  return claim ? "preparing" : "needed";
}

export interface PreparedItemLesson {
  state: "ready" | "preparing";
  lesson: ItemLesson | null;
  cached: boolean;
}

/**
 * Resolve today's one-lesson-ahead slot. The caller chooses whether a model client
 * is genuinely reachable; every other condition completes the authored fallback
 * immediately. The winning claim stays owned through a failed call and is filled
 * with authored Italian before returning, so retries cannot re-bill the same item.
 */
export async function prepareItemLesson(
  db: Db,
  client: TextModelClient | null,
  itemId: string,
): Promise<PreparedItemLesson> {
  sweepStaleItemLessonClaims(db);
  const existing = getItemLesson(db, itemId);
  if (existing) return { state: "ready", lesson: existing, cached: true };

  const kind = itemLessonKind(itemId);
  if (!kind) throw new Error(`There is no lesson format for ${itemId}.`);
  const register = lessonRegister(db);
  const won = claimItemLesson(db, { itemId, kind, register });
  if (!won) {
    const resolved = getItemLesson(db, itemId);
    return resolved
      ? { state: "ready", lesson: resolved, cached: true }
      : { state: "preparing", lesson: null, cached: true };
  }

  const authored = authoredLessonFor(db, itemId, register);
  if (!client) {
    return { state: "ready", lesson: completeItemLesson(db, authored, itemId), cached: false };
  }

  try {
    const lesson = await callWithBrevityRepair(db, client, {
      itemId,
      kind,
      register,
      basePrompt: itemLessonPrompt(db, itemId, register),
      fallback: fallbackDrillsFor(itemId),
    });
    return { state: "ready", lesson, cached: false };
  } catch {
    // The provider may have rejected the key, failed on the network, returned
    // invalid JSON, or failed the Italian gate. The claim is deliberately NOT
    // released: filling it with authored content makes the failure final and free
    // on every later home read/open.
    return { state: "ready", lesson: completeItemLesson(db, authored, itemId), cached: false };
  }
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
 * One call and at most ONE bounded repair. A truncation asks for a shorter answer
 * with more room; an Italian-language rejection asks for every visible field to be
 * rewritten in Italian. Any failure of the repair falls back to authored content at
 * the preparation seam.
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
  let repair: "brevity" | "italian" | null = null;
  let firstFailure: Error | null = null;
  for (let index = 0; index < 2; index++) {
    const instruction =
      repair === "brevity"
        ? BREVITY_RETRY_INSTRUCTION
        : repair === "italian"
          ? ITALIAN_REPAIR_INSTRUCTION
          : null;
    const attempt = {
      prompt: instruction ? `${input.basePrompt}\n\n${instruction}` : input.basePrompt,
      ceiling: repair === "brevity" ? lessonRepairTokenCeiling() : ITEM_LESSON_MAX_OUTPUT_TOKENS,
      hash: index === 0 ? `item-lesson:${input.itemId}` : `item-lesson-repair:${input.itemId}`,
    };
    const { completion, costUsd, reservation } = await runBilledTextCall(db, client, {
      prompt: attempt.prompt,
      maxOutputTokens: attempt.ceiling,
      contentHash: attempt.hash,
    });

    // The call resolved, so it was billed. Every branch finalizes FIRST — never
    // understate spend precisely when things are going wrong (E-16 defect 4).
    if (wasTruncated(completion)) {
      finalizeReservation(db, reservation, costUsd);
      const truncation = new TextModelTruncatedError(`The lesson reply was cut off at ${attempt.ceiling} tokens.`);
      if (index > 0) throw truncation;
      firstFailure = truncation;
      repair = "brevity";
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
      if (index === 0 && err instanceof ItalianLessonLanguageError) {
        firstFailure = err;
        repair = "italian";
        continue;
      }
      throw err;
    }

    return db.transaction(() => {
      finalizeReservation(db, reservation, costUsd);
      return completeItemLesson(db, parsed);
    })();
  }
  throw firstFailure ?? new TextModelParseError("The lesson could not be generated.");
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
  const cached = getItemLesson(db, itemId);
  if (cached) return cached;
  const prepared = await prepareItemLesson(db, client, itemId);
  return prepared.lesson;
}
