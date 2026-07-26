export const TUTOR_ERROR_CATEGORIES = [
  "grammar",
  "vocabulary",
  "phrasing",
  "idiom",
  "pronunciation",
] as const;
export type TutorErrorCategory = (typeof TUTOR_ERROR_CATEGORIES)[number];

export interface TutorTurnError {
  quote: string;
  correction: string;
  category: TutorErrorCategory;
  explanation: string;
  confidence: "high" | "medium";
}

export interface TutorTurnEvidence {
  itemId: string;
  polarity: "correct" | "incorrect";
  mode: "spontaneous" | "cued";
}

export interface TutorTurnResult {
  errors: TutorTurnError[];
  reply: string;
  evidence: TutorTurnEvidence[];
}

export interface ParsedTutorTurn {
  result: TutorTurnResult;
  droppedErrors: TutorTurnError[];
}

export class TutorTurnParseError extends Error {}

const ERROR_KEYS = ["category", "confidence", "correction", "explanation", "quote"] as const;
const EVIDENCE_KEYS = ["itemId", "mode", "polarity"] as const;
const RESULT_KEYS = ["errors", "evidence", "reply"] as const;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function nonEmptyString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function parseError(value: unknown): TutorTurnError {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TutorTurnParseError("Every detected error must be an object.");
  }
  const item = value as Record<string, unknown>;
  if (!exactKeys(item, ERROR_KEYS)) throw new TutorTurnParseError("A detected error was off schema.");
  if (!nonEmptyString(item.quote, 400) || !nonEmptyString(item.correction, 400)) {
    throw new TutorTurnParseError("A detected error needs a bounded quote and correction.");
  }
  if (!nonEmptyString(item.explanation, 800)) {
    throw new TutorTurnParseError("A detected error needs a bounded explanation.");
  }
  if (!(TUTOR_ERROR_CATEGORIES as readonly unknown[]).includes(item.category)) {
    throw new TutorTurnParseError("A detected error used an unknown category.");
  }
  if (item.confidence !== "high" && item.confidence !== "medium") {
    throw new TutorTurnParseError("A detected error used an unsupported confidence.");
  }
  return {
    quote: item.quote.trim(),
    correction: item.correction.trim(),
    category: item.category as TutorErrorCategory,
    explanation: item.explanation.trim(),
    confidence: item.confidence,
  };
}

function parseEvidence(value: unknown): TutorTurnEvidence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TutorTurnParseError("Every evidence item must be an object.");
  }
  const item = value as Record<string, unknown>;
  if (!exactKeys(item, EVIDENCE_KEYS)) throw new TutorTurnParseError("An evidence item was off schema.");
  if (!nonEmptyString(item.itemId, 240)) throw new TutorTurnParseError("An evidence item needs an itemId.");
  if (item.polarity !== "correct" && item.polarity !== "incorrect") {
    throw new TutorTurnParseError("An evidence item used an unsupported polarity.");
  }
  if (item.mode !== "spontaneous" && item.mode !== "cued") {
    throw new TutorTurnParseError("An evidence item used an unsupported mode.");
  }
  return { itemId: item.itemId.trim(), polarity: item.polarity, mode: item.mode };
}

/**
 * Realtime text-out repeatedly wraps an otherwise-valid object in one outer
 * parenthesis pair — `({...})` — even when the prompt forbids it. Unwrap that single
 * measured quirk so the strict schema still applies to the object itself. Fences and
 * surrounding prose remain rejected.
 */
export function unwrapTutorTurnPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("(") && trimmed.endsWith(")"))) return trimmed;
  const inner = trimmed.slice(1, -1).trim();
  return inner.startsWith("{") && inner.endsWith("}") ? inner : trimmed;
}

/**
 * Parse the provider boundary strictly. Markdown fences and prose are rejected rather
 * than extracted: a repair may make them valid, but an off-contract reply never reaches
 * TTS or evidence. Transcript pronunciation claims are removed and returned separately
 * so the experiment details can say exactly what was withheld.
 */
export function parseTutorTurnResult(
  raw: string,
  options: { allowPronunciation: boolean },
): ParsedTutorTurn {
  const text = unwrapTutorTurnPayload(raw);
  if (text.startsWith("```") || text.endsWith("```")) {
    throw new TutorTurnParseError("The model wrapped its result in a code fence.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TutorTurnParseError("The model result was not complete JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TutorTurnParseError("The model result was not an object.");
  }
  const root = parsed as Record<string, unknown>;
  if (!exactKeys(root, RESULT_KEYS)) throw new TutorTurnParseError("The model result was off schema.");
  if (!Array.isArray(root.errors) || root.errors.length > 12) {
    throw new TutorTurnParseError("The model result carried an invalid errors array.");
  }
  if (!Array.isArray(root.evidence) || root.evidence.length > 16) {
    throw new TutorTurnParseError("The model result carried an invalid evidence array.");
  }
  if (!nonEmptyString(root.reply, 1200)) {
    throw new TutorTurnParseError("The model result needs one bounded spoken reply.");
  }
  const errors = root.errors.map(parseError);
  const droppedErrors = options.allowPronunciation
    ? []
    : errors.filter((error) => error.category === "pronunciation");
  return {
    result: {
      errors: errors.filter((error) => options.allowPronunciation || error.category !== "pronunciation"),
      reply: root.reply.trim(),
      evidence: root.evidence.map(parseEvidence),
    },
    droppedErrors,
  };
}

export const TUTOR_TURN_JSON_SCHEMA = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          quote: { type: "string" },
          correction: { type: "string" },
          category: { type: "string", enum: [...TUTOR_ERROR_CATEGORIES] },
          explanation: { type: "string" },
          confidence: { type: "string", enum: ["high", "medium"] },
        },
        required: [...ERROR_KEYS],
        additionalProperties: false,
      },
    },
    reply: { type: "string" },
    evidence: {
      type: "array",
      maxItems: 16,
      items: {
        type: "object",
        properties: {
          itemId: { type: "string" },
          polarity: { type: "string", enum: ["correct", "incorrect"] },
          mode: { type: "string", enum: ["spontaneous", "cued"] },
        },
        required: [...EVIDENCE_KEYS],
        additionalProperties: false,
      },
    },
  },
  required: [...RESULT_KEYS],
  additionalProperties: false,
} as const;

export const TURN_RECOVERY_MESSAGE =
  "Erika could not read that turn safely. Nothing was spoken or recorded as evidence; tap Speak to try again.";
