import type { Db } from "../db";
import type { Finding } from "../analysis/findings";
import { listIncludedFindings } from "../findings-model";
import { profileBlock, type SpeakerProfile } from "../analysis/profile";
import { TEXT_MODEL, ASK_MAX_OUTPUT_TOKENS, estimateTokens, textCallCost } from "../analysis/rates";
import { extractJsonObject, TextModelParseError } from "../lessons/text-model";

// The pure parts of Ask Erika (E-23): pick the compact set of the user's OTHER
// findings a note may cite, build the JSON-requesting prompt, and parse the reply
// into a note plus its citations. Kept out of the engine so tests exercise them
// directly on fixtures. The corpus scope comes WHOLE from lib/findings-model.ts —
// `selectCandidates` only orders and bounds it, it does not reimplement the
// "what counts as a finding" math. Speaker priming reuses lib/analysis/profile.ts.

/** How many of the user's other findings are offered to the model as citables. */
export const ASK_MAX_CANDIDATES = 6;

/**
 * The compact set of OTHER included findings this note may cite, newest-first with
 * same-category findings preferred (they are the most likely to share a rule).
 * Read through the canonical model (`listIncludedFindings`), so a candidate is
 * always a real included finding the corpus would show — never the target itself.
 * Empty only when the target is the user's sole finding.
 */
export function selectCandidates(db: Db, finding: Finding): Finding[] {
  const others = listIncludedFindings(db).filter((f) => f.id !== finding.id);
  const sameCategory = others.filter((f) => f.category === finding.category);
  const rest = others.filter((f) => f.category !== finding.category);
  return [...sameCategory, ...rest].slice(0, ASK_MAX_CANDIDATES);
}

/**
 * Build the JSON-requesting ask prompt: the finding the user asked about, the
 * bounded speaker profile (E-19) when given, and the candidate other findings
 * tagged with their ids. The model is told to relate the note to at least one of
 * them and cite the ids it uses.
 */
export function askPrompt(
  targetLanguage: string,
  finding: Finding,
  candidates: readonly Finding[],
  profile?: SpeakerProfile,
): string {
  const others = candidates
    .map((c) => `[${c.id}] said "${c.quote}" → "${c.correction}" (${c.category})`)
    .join("\n");
  return [
    `You are an expert ${targetLanguage} coach answering an advanced learner who asked for a deeper explanation of one correction.`,
    ...(profile ? [profileBlock(profile)] : []),
    `The correction they asked about: said "${finding.quote}" → "${finding.correction}" (${finding.category}). Why: ${finding.explanation}`,
    "",
    "Other corrections from this same learner's own history (id in brackets):",
    others,
    "",
    "Write a deeper note of 3-6 sentences that explains the underlying rule and ties it to the learner's own pattern.",
    "You MUST relate the note to at least one of the other corrections above and cite the ones you draw on by their id.",
    "Respond with JSON ONLY, no prose, shaped exactly:",
    '{"note": string, "cites": [string, ...]}',
    "`cites` holds the bracketed ids (without the brackets) of the other corrections you referenced; include at least one.",
  ].join("\n");
}

/** Worst-case USD to generate this finding's note, per the rates machinery. */
export function askEstimateUsd(prompt: string): number {
  return textCallCost(TEXT_MODEL, estimateTokens(prompt), ASK_MAX_OUTPUT_TOKENS);
}

export interface ParsedNote {
  note: string;
  /** The cited OTHER-finding ids — guaranteed non-empty and ⊆ the candidate ids. */
  citedIds: string[];
}

function asString(v: unknown, ctx: string): string {
  if (typeof v !== "string" || v.trim() === "") throw new TextModelParseError(`${ctx} must be a non-empty string.`);
  return v.trim();
}

/**
 * Parse an ask reply into a validated note plus its citations, given the candidate
 * findings it was allowed to cite. The note text is required; malformed JSON or a
 * missing note rejects the whole reply truthfully (the caller ledgers the charge
 * and releases the claim, persisting nothing). The citations are then made
 * STRUCTURAL and safe: only ids present in the candidate set survive (a
 * hallucinated id is dropped), and if the model cited none that resolve, we fall
 * back to the top candidate — so a completed note ALWAYS carries ≥1 citation that
 * resolves to a real OTHER included finding. Requires a non-empty candidate set
 * (the engine refuses to ask when the corpus has no other finding to cite).
 */
export function parseAskResponse(raw: string, candidates: readonly Finding[]): ParsedNote {
  if (candidates.length === 0) throw new TextModelParseError("No other findings are available to cite.");
  const obj = extractJsonObject(raw);
  const note = asString(obj.note, "Note");
  const candidateIds = new Set(candidates.map((c) => c.id));
  const cited = Array.isArray(obj.cites)
    ? [...new Set(obj.cites.filter((c): c is string => typeof c === "string" && candidateIds.has(c)))]
    : [];
  return { note, citedIds: cited.length > 0 ? cited : [candidates[0].id] };
}
