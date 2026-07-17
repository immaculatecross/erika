import { isCategory, isSeverity, type NewFinding } from "./findings";
import { MINI_MODEL, type ModelId } from "./rates";

// The ONE module that talks to OpenAI's audio models (D-3, D-10). Everything
// network- and prompt-shaped is isolated here behind a typed `AudioModelClient`
// interface, so the cascade, cost, and budget logic are unit-tested against a
// mock and no test ever makes a real call. The pure response parsers are
// exported so criterion-2 tests can exercise them directly on fixtures.
//
// Audio goes in as a base64 `input_audio` content part (D-3 — native audio,
// never speech-to-text); the model is asked for structured JSON out. The API key
// is read from the environment at call time and never logged.

export interface TriageInput {
  /** base64-encoded audio (the segment's time-compressed triage rendition). */
  audioBase64: string;
  /** Container format of the audio, e.g. "wav". */
  format: string;
  targetLanguage: string;
}

export interface TriageResult {
  flagged: boolean;
  reason?: string;
}

export interface DeepInput {
  /** base64-encoded audio (the original, native-speed segment). */
  audioBase64: string;
  format: string;
  targetLanguage: string;
}

export interface DeepResult {
  /** Findings with offsets *relative to the segment start*, in ms. */
  findings: (NewFinding & { relStartMs?: number; relEndMs?: number })[];
}

/** The seam the cascade depends on. The real impl calls OpenAI; tests mock it. */
export interface AudioModelClient {
  triage(input: TriageInput): Promise<TriageResult>;
  deepListen(model: ModelId, input: DeepInput): Promise<DeepResult>;
}

/** Thrown when a model/endpoint is unavailable or unauthorized (a real blocker). */
export class ModelUnavailableError extends Error {}
/** Thrown when a model response cannot be parsed into the expected shape. */
export class ModelParseError extends Error {}

// ---- prompts -------------------------------------------------------------

export function triagePrompt(targetLanguage: string): string {
  return [
    `You are triaging a language learner's ${targetLanguage} speech. The audio is time-compressed.`,
    "Focus ONLY on the dominant/primary speaker; ignore background or bystander voices.",
    "Decide whether the dominant speaker makes any notable non-native error (grammar, vocabulary,",
    "phrasing, idiom, or pronunciation) worth a detailed review.",
    'Respond with JSON only: {"flagged": boolean, "reason": string}.',
  ].join(" ");
}

// The dominant-speaker instruction is prompt-level for v1; true voice enrollment
// and diarization are E-13. Tests assert this instruction is present.
export const DOMINANT_SPEAKER_INSTRUCTION =
  "Focus ONLY on the dominant/primary speaker; ignore background or bystander voices (bystanders are never analyzed).";

export function deepPrompt(targetLanguage: string): string {
  return [
    `You are an expert ${targetLanguage} coach reviewing a learner's speech at native speed.`,
    DOMINANT_SPEAKER_INSTRUCTION,
    "Identify each genuine error the dominant speaker makes. For each, give the quote, a correction,",
    "a category (one of: grammar, vocabulary, phrasing, idiom, pronunciation), a short explanation,",
    "a severity (high, medium, low), and its approximate start/end time within this clip in",
    "milliseconds (relStartMs, relEndMs).",
    'Respond with JSON only: {"findings": [{"quote": string, "correction": string,',
    '"category": string, "explanation": string, "severity": string, "relStartMs": number,',
    '"relEndMs": number}]}. Return an empty findings array if the speaker made no errors.',
  ].join(" ");
}

// ---- pure parsers (tested directly) -------------------------------------

function asObject(raw: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ModelParseError("Model response was not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ModelParseError("Model response was not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

/** Parse a triage response. A missing/non-boolean `flagged` is a truthful error. */
export function parseTriageResponse(raw: string): TriageResult {
  const obj = asObject(raw);
  if (typeof obj.flagged !== "boolean") {
    throw new ModelParseError("Triage response missing a boolean `flagged`.");
  }
  return { flagged: obj.flagged, reason: typeof obj.reason === "string" ? obj.reason : undefined };
}

/**
 * Parse a deep-listen response into validated findings. Any malformed or partial
 * finding rejects the WHOLE response with a truthful error — the cascade must
 * never persist half a segment's garbage (criterion 2).
 */
export function parseDeepResponse(raw: string): DeepResult {
  const obj = asObject(raw);
  if (!Array.isArray(obj.findings)) {
    throw new ModelParseError("Deep response missing a `findings` array.");
  }
  const findings = obj.findings.map((item, i) => {
    if (typeof item !== "object" || item === null) {
      throw new ModelParseError(`Finding ${i} is not an object.`);
    }
    const f = item as Record<string, unknown>;
    for (const key of ["quote", "correction", "explanation"] as const) {
      if (typeof f[key] !== "string" || (f[key] as string).trim() === "") {
        throw new ModelParseError(`Finding ${i} has an invalid \`${key}\`.`);
      }
    }
    if (!isCategory(f.category)) throw new ModelParseError(`Finding ${i} has an invalid \`category\`.`);
    if (!isSeverity(f.severity)) throw new ModelParseError(`Finding ${i} has an invalid \`severity\`.`);
    const relStartMs = numberOrUndefined(f.relStartMs);
    const relEndMs = numberOrUndefined(f.relEndMs);
    return {
      quote: (f.quote as string).trim(),
      correction: (f.correction as string).trim(),
      category: f.category,
      explanation: (f.explanation as string).trim(),
      severity: f.severity,
      startMs: 0,
      endMs: 0,
      relStartMs,
      relEndMs,
    };
  });
  return { findings };
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
}

// ---- the real OpenAI client ---------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new ModelUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

async function callModel(model: ModelId, prompt: string, input: TriageInput | DeepInput): Promise<string> {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        model,
        modalities: ["text"],
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "input_audio", input_audio: { data: input.audioBase64, format: input.format } },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    throw new ModelUnavailableError(`Network error calling ${model}: ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `${model} call failed: ${res.status} ${res.statusText} ${body}`.trim();
    // 4xx around auth/model are legitimate "stop, don't retry-thrash" blockers.
    throw new ModelUnavailableError(msg);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new ModelParseError(`${model} returned no message content.`);
  return content;
}

/** The production client. Kept thin: build prompt → call → hand off to a parser. */
export const openAiAudioModel: AudioModelClient = {
  async triage(input) {
    return parseTriageResponse(await callModel(MINI_MODEL, triagePrompt(input.targetLanguage), input));
  },
  async deepListen(model, input) {
    return parseDeepResponse(await callModel(model, deepPrompt(input.targetLanguage), input));
  },
};
