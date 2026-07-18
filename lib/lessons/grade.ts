import type { Db } from "../db";
import { readSettings } from "../settings";
import { recordSpend } from "../analysis/budget";
import { TEXT_MODEL } from "../analysis/rates";
import { extractJsonObject, TextModelParseError, type TextModelClient } from "./text-model";
import { parseBilledResponse, runBilledTextCall } from "./billing";

// Rewrite grading (E-6, WO criterion 3): grade a learner's free-text rewrite
// against the exercise's target sentence with ONE budget-checked text-model call
// at request time. The pure prompt builder and parser are exported for direct
// fixture tests: a correct or incorrect verdict parses into {correct, feedback};
// a malformed reply is rejected truthfully. Grading records its spend into the
// shared ledger but persists no lesson — a grade is a transient judgement.

/** Output-token allowance for a grade — bounds the worst-case pre-call cost. */
export const GRADE_MAX_OUTPUT_TOKENS = 300;

export interface GradeResult {
  correct: boolean;
  feedback: string;
}

/** Build the JSON-requesting prompt to grade `rewrite` against `target`. */
export function gradePrompt(targetLanguage: string, target: string, rewrite: string): string {
  return [
    `You are an expert ${targetLanguage} coach grading a learner's rewrite of a sentence.`,
    `Target (a correct version): "${target}"`,
    `Learner's rewrite: "${rewrite}"`,
    `Decide whether the rewrite is correct and natural ${targetLanguage} that conveys the target's meaning.`,
    "Minor stylistic differences are fine; genuine grammar/word errors are not.",
    'Respond with JSON ONLY: {"correct": boolean, "feedback": string}.',
    "Feedback is one short, encouraging sentence explaining the verdict.",
  ].join("\n");
}

/**
 * Parse a grading response into a validated verdict. A missing/non-boolean
 * `correct` or empty `feedback` is a truthful parse error (WO criterion 3).
 * Tolerates fenced/prose JSON.
 */
export function parseGradeResponse(raw: string): GradeResult {
  const obj = extractJsonObject(raw);
  if (typeof obj.correct !== "boolean") {
    throw new TextModelParseError("Grade response missing a boolean `correct`.");
  }
  if (typeof obj.feedback !== "string" || obj.feedback.trim() === "") {
    throw new TextModelParseError("Grade response missing a non-empty `feedback`.");
  }
  return { correct: obj.correct, feedback: obj.feedback.trim() };
}

/**
 * Grade a rewrite against its target. Budget-check → one model call → parse →
 * record the spend into the shared ledger. Throws `BudgetExceededError` before
 * any call if the cap would be breached — no call, so nothing recorded — or
 * `TextModelParseError` on a malformed reply, which DOES record the charge: that
 * call resolved and was billed (E-16 defect 4). `patternKey` is the ledger
 * witness — the pattern the graded exercise belongs to.
 */
export async function gradeRewrite(
  db: Db,
  client: TextModelClient,
  input: { patternKey: string; target: string; rewrite: string },
): Promise<GradeResult> {
  const { targetLanguage } = readSettings(db);
  const prompt = gradePrompt(targetLanguage, input.target, input.rewrite);
  const { completion, costUsd } = await runBilledTextCall(db, client, {
    prompt,
    maxOutputTokens: GRADE_MAX_OUTPUT_TOKENS,
  });
  const ledgerKey = `grade:${input.patternKey}`;
  // The call resolved, so it was billed: a malformed reply still ledgers the
  // charge (E-16 defect 4) before rethrowing, rather than silently eating it.
  const result = parseBilledResponse(db, { contentHash: ledgerKey, costUsd }, () =>
    parseGradeResponse(completion.text),
  );
  recordSpend(db, { model: TEXT_MODEL, contentHash: ledgerKey, costUsd });
  return result;
}
