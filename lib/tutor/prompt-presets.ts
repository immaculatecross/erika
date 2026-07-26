import { createHash } from "node:crypto";
import { mistakeClasses, precisionCore } from "../mistakes";
import { CATEGORY_MAPPING_INSTRUCTION } from "../analysis/prompts";
import { coerceRegister, registerInstruction } from "../register";
import { buildTutorPersona, type TutorPersonaInput } from "./persona";
import type { TutorArchitecture, TutorPromptPreset } from "./experiment";

const EMPTY_IS_VALID =
  "Inspect the whole learner turn. Identify each genuine error in `errors`; an empty errors array is valid and expected when the speech is correct.";
const BREVITY =
  "The spoken `reply` must be one or two natural Italian sentences. It may speak at most one correction, then continue the conversation; never turn the reply into a list or lecture.";
const ANTI_NARRATION =
  "Never narrate tools, notes, analysis, bookkeeping, or what you are about to do. Return only the structured result.";
const CORRECTION_FORWARD =
  "When correcting, lead with the correct form, mention the learner's quote once for context, and never ask them to rehearse an error.";
const EVIDENCE_POLICY =
  "Put evidence in `evidence` only for exact lemma or rule ids named in the prompt. Never invent an id. Use spontaneous unless the tutor explicitly cued that production.";

const OUTPUT_CONTRACT = `Return exactly one JSON object and no prose or markdown:
{"errors":[{"quote":"string","correction":"string","category":"grammar|vocabulary|phrasing|idiom|pronunciation","explanation":"string","confidence":"high|medium"}],"reply":"string","evidence":[{"itemId":"validated id","polarity":"correct|incorrect","mode":"spontaneous|cued"}]}
The first character must be { and the last must be }; add no parentheses, fences, label, or commentary.
Every key is required. Do not add keys. A complete empty result uses "errors":[] and "evidence":[]; reply is never empty.`;

const RECORD_EQUIVALENT =
  "Use the Record path's policy: identify each genuine error; put every genuine error in `errors`, while the spoken reply still selects at most one.";
const BALANCED =
  "Inspect the whole turn and list every clear error internally; speak the single most useful correction, then continue naturally. Correct speech gets ordinary conversation, not a forced correction.";
const PRECISION_FIRST =
  "A correction requires high confidence. Valid regional or register variants pass. If acoustic uncertainty matters, ask for repetition instead of guessing. There is no quota to find an error.";
const TRANSCRIPT_GUARD =
  "This input is a fallible transcript, not a recording of exactly what the learner certainly said. Never report pronunciation, hesitation, pacing, or any acoustic finding; category `pronunciation` is forbidden.";

function block(title: string, lines: readonly string[] | undefined): string | null {
  const clean = (lines ?? []).map((line) => line.trim()).filter(Boolean);
  return clean.length === 0 ? null : [title, ...clean.map((line) => `- ${line}`)].join("\n");
}

function contextParts(input: TutorPersonaInput): string[] {
  const parts = [
    `You are Erika, a warm, exacting ${input.targetLanguage} conversation tutor for an advanced learner whose native language is ${input.nativeLanguage}.`,
    registerInstruction(coerceRegister(input.register)),
  ];
  const profile = block("What you know about this learner:", input.profileLines);
  const slips = block("Recurring mistakes to steer toward without rehearsing the error:", input.slipTargets);
  const targets = block("Today's validated targets:", input.todayTargets);
  if (profile) parts.push(profile);
  if (slips) parts.push(slips);
  if (targets) parts.push(targets);
  return parts;
}

function sharedCoachingParts(input: TutorPersonaInput): string[] {
  return [
    ...contextParts(input),
    EVIDENCE_POLICY,
    CORRECTION_FORWARD,
    ANTI_NARRATION,
    BREVITY,
  ];
}

export interface BuildTutorPromptInput {
  preset: TutorPromptPreset;
  architecture: TutorArchitecture;
  persona: TutorPersonaInput;
}

/** Build all five hypotheses from shared parts; only their distinguishing policy varies. */
export function buildTutorPrompt(input: BuildTutorPromptInput): string {
  const { preset, architecture, persona } = input;
  let parts: string[];
  switch (preset) {
    case "record-equivalent":
      parts = [
        ...sharedCoachingParts(persona),
        mistakeClasses(),
        precisionCore(),
        CATEGORY_MAPPING_INSTRUCTION,
        RECORD_EQUIVALENT,
        EMPTY_IS_VALID,
      ];
      break;
    case "minimal":
      parts = [
        `You are an exact ${persona.targetLanguage} conversation tutor.`,
        mistakeClasses(),
        precisionCore(),
        EMPTY_IS_VALID,
        BREVITY,
      ];
      break;
    case "balanced":
      parts = [
        ...sharedCoachingParts(persona),
        mistakeClasses(),
        precisionCore(),
        BALANCED,
        EMPTY_IS_VALID,
      ];
      break;
    case "precision":
      parts = [
        ...sharedCoachingParts(persona),
        mistakeClasses(),
        precisionCore(),
        PRECISION_FIRST,
        EMPTY_IS_VALID,
      ];
      break;
    case "current":
      parts = [
        buildTutorPersona({ ...persona, evidenceDelivery: "result" }),
        "Preserve the current tutor's detection and one-correction policy exactly; the structured envelope changes delivery, not judgment.",
        EMPTY_IS_VALID,
      ];
      break;
  }
  if (architecture === "transcript") parts.push(TRANSCRIPT_GUARD);
  parts.push(OUTPUT_CONTRACT);
  return parts.join("\n\n");
}

export function tutorPromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex");
}

export const PROMPT_DISTINGUISHING_CLAUSES = {
  "record-equivalent": RECORD_EQUIVALENT,
  minimal: "You are an exact",
  balanced: BALANCED,
  precision: PRECISION_FIRST,
  current:
    "Preserve the current tutor's detection and one-correction policy exactly; the structured envelope changes delivery, not judgment.",
} as const satisfies Record<TutorPromptPreset, string>;

export const TUTOR_OUTPUT_CONTRACT = OUTPUT_CONTRACT;
export const TRANSCRIPT_PROMPT_GUARD = TRANSCRIPT_GUARD;
