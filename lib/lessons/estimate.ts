import type { Db } from "../db";
import { readSettings } from "../settings";
import { estimateTokens, TEXT_MODEL, textCallCost } from "../analysis/rates";
import { LESSON_MAX_OUTPUT_TOKENS, lessonPrompt } from "./generate";
import type { Pattern } from "./patterns";

// The pre-generation price of a lesson (E-18 criterion 5) — display only. This is
// the SAME upper bound `runBilledTextCall` checks against the cap before the real
// call (lib/lessons/billing.ts): the actual prompt priced at the model's token
// rates with the full output allowance assumed spent. No new pricing math, no
// model call, no write — a number the lessons list can state next to "Generate".

/** Worst-case USD to generate `pattern`'s lesson, per the existing estimate machinery. */
export function lessonEstimateUsd(db: Db, pattern: Pattern): number {
  const { targetLanguage } = readSettings(db);
  const prompt = lessonPrompt(targetLanguage, pattern);
  return textCallCost(TEXT_MODEL, estimateTokens(prompt), LESSON_MAX_OUTPUT_TOKENS);
}
