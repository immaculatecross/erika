import type { Db } from "../db";
import { readSettings } from "../settings";
import { recordSpend } from "../analysis/budget";
import { TEXT_MODEL } from "../analysis/rates";
import { extractJsonObject, TextModelParseError, type TextModelClient } from "./text-model";
import { EXERCISE_TYPES, insertLesson, getLessonByPattern, type Exercise, type Lesson, type NewLesson } from "./lessons";
import { runBilledTextCall } from "./billing";
import type { Pattern } from "./patterns";

// Lesson generation (E-6, WO criterion 2): turn a recurring error pattern into a
// short grammar lesson with typed exercises, via ONE budget-checked text-model
// call at request time (not a worker job). The pure prompt builder and response
// parser are exported so tests exercise them directly on fixtures — a good
// response yields typed exercises; a malformed/partial one is rejected whole with
// a truthful error and nothing is persisted (mirrors parseDeepResponse in E-4).

/** Output-token allowance for a lesson — bounds the worst-case pre-call cost. */
export const LESSON_MAX_OUTPUT_TOKENS = 1200;

/** How many of a pattern's findings to feed the model as source material. */
const MAX_SOURCE_FINDINGS = 8;

/** Build the JSON-requesting prompt for a pattern, grounded in the user's own findings. */
export function lessonPrompt(targetLanguage: string, pattern: Pattern): string {
  const examples = pattern.findings
    .slice(0, MAX_SOURCE_FINDINGS)
    .map((f, i) => `${i + 1}. said "${f.quote}" → should be "${f.correction}" (${f.explanation})`)
    .join("\n");
  return [
    `You are an expert ${targetLanguage} coach writing a short micro-lesson for an advanced learner.`,
    `The learner keeps making ${pattern.category} errors. Here are real examples from their own speech:`,
    examples,
    "",
    "Write a focused lesson targeting this recurring pattern. Respond with JSON ONLY, no prose, shaped exactly:",
    '{"explanation": string, "exercises": [',
    '  {"type":"multiple_choice","prompt":string,"options":[string,...],"answerIndex":number},',
    '  {"type":"fill_in","prompt":string,"answer":string},',
    '  {"type":"rewrite","prompt":string,"target":string}',
    "]}",
    "The explanation is 2-4 sentences. Include 3-5 exercises mixing the three types above,",
    "drawn from the learner's actual mistakes. answerIndex is 0-based into options.",
  ].join("\n");
}

function asString(v: unknown, ctx: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new TextModelParseError(`${ctx} must be a non-empty string.`);
  return v.trim();
}

/** Validate one exercise object into a typed `Exercise`; any defect rejects it truthfully. */
function parseExercise(raw: unknown, i: number): Exercise {
  if (typeof raw !== "object" || raw === null) throw new TextModelParseError(`Exercise ${i} is not an object.`);
  const e = raw as Record<string, unknown>;
  if (typeof e.type !== "string" || !(EXERCISE_TYPES as readonly string[]).includes(e.type)) {
    throw new TextModelParseError(`Exercise ${i} has an invalid \`type\`.`);
  }
  const prompt = asString(e.prompt, `Exercise ${i} prompt`);
  if (e.type === "multiple_choice") {
    if (!Array.isArray(e.options) || e.options.length < 2) {
      throw new TextModelParseError(`Exercise ${i} needs an options array of 2+.`);
    }
    const options = e.options.map((o, j) => asString(o, `Exercise ${i} option ${j}`));
    if (typeof e.answerIndex !== "number" || !Number.isInteger(e.answerIndex) || e.answerIndex < 0 || e.answerIndex >= options.length) {
      throw new TextModelParseError(`Exercise ${i} has an out-of-range \`answerIndex\`.`);
    }
    return { type: "multiple_choice", prompt, options, answerIndex: e.answerIndex };
  }
  if (e.type === "fill_in") {
    return { type: "fill_in", prompt, answer: asString(e.answer, `Exercise ${i} answer`) };
  }
  return { type: "rewrite", prompt, target: asString(e.target, `Exercise ${i} target`) };
}

/**
 * Parse a lesson response into a validated `NewLesson`. Any malformed or partial
 * exercise rejects the WHOLE response with a truthful error, so the caller never
 * persists half a garbage lesson (WO criterion 2). Tolerates fenced/prose JSON.
 */
export function parseLessonResponse(raw: string): NewLesson {
  const obj = extractJsonObject(raw);
  const explanation = asString(obj.explanation, "Lesson explanation");
  if (!Array.isArray(obj.exercises) || obj.exercises.length === 0) {
    throw new TextModelParseError("Lesson response missing a non-empty `exercises` array.");
  }
  const exercises = obj.exercises.map((e, i) => parseExercise(e, i));
  return { explanation, exercises };
}

/**
 * Generate (or return the cached) lesson for a pattern. A cache hit makes ZERO
 * model calls and records nothing (WO criterion 4). Otherwise: budget-check →
 * one model call → parse → persist the lesson and record its spend atomically in
 * one transaction (a lesson is never stored without its charge, nor charged
 * without being stored). Throws `BudgetExceededError` before any call if the cap
 * would be breached, or `TextModelParseError` on a malformed reply (no persist).
 */
export async function generateLessonForPattern(
  db: Db,
  client: TextModelClient,
  pattern: Pattern,
): Promise<{ lesson: Lesson; cached: boolean }> {
  const existing = getLessonByPattern(db, pattern.key);
  if (existing) return { lesson: existing, cached: true };

  const { targetLanguage } = readSettings(db);
  const prompt = lessonPrompt(targetLanguage, pattern);
  const { completion, costUsd } = await runBilledTextCall(db, client, {
    prompt,
    maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS,
  });
  const parsed = parseLessonResponse(completion.text); // throws before any write on malformed

  const lesson = db.transaction(() => {
    recordSpend(db, { model: TEXT_MODEL, contentHash: pattern.key, costUsd });
    return insertLesson(db, pattern.key, parsed);
  })();
  return { lesson, cached: false };
}
