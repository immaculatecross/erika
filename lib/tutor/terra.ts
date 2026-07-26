import {
  TERRA_MAX_OUTPUT_TOKENS,
  TERRA_MODEL,
  type TerraUsage,
} from "../analysis/rates";
import { TUTOR_TURN_JSON_SCHEMA } from "./turn-result";

export const RESPONSES_URL = "https://api.openai.com/v1/responses";
export const TERRA_REASONING_EFFORT = "low" as const;
export const MAX_TUTOR_CONTEXT_CHARS = 12_000;

export interface TutorContextTurn {
  learner: string;
  tutor: string;
}

export interface TerraCompletion {
  text: string;
  usage: TerraUsage;
  responseId: string | null;
}

export interface TerraClient {
  complete(input: {
    prompt: string;
    transcript: string;
    context: readonly TutorContextTurn[];
    repairOf?: string;
  }): Promise<TerraCompletion>;
}

export class TerraUnavailableError extends Error {}

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TerraUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

export function boundedTutorContext(turns: readonly TutorContextTurn[]): TutorContextTurn[] {
  const kept: TutorContextTurn[] = [];
  let chars = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    const size = turn.learner.length + turn.tutor.length;
    if (kept.length > 0 && chars + size > MAX_TUTOR_CONTEXT_CHARS) break;
    kept.unshift({ learner: turn.learner.slice(0, 4000), tutor: turn.tutor.slice(0, 2000) });
    chars += size;
  }
  return kept;
}

export function buildTerraRequest(input: {
  prompt: string;
  transcript: string;
  context: readonly TutorContextTurn[];
  repairOf?: string;
}): Record<string, unknown> {
  const context = boundedTutorContext(input.context);
  const conversation = context
    .map((turn) => `Learner transcript (fallible): ${turn.learner}\nTutor reply: ${turn.tutor}`)
    .join("\n\n");
  const current = `Current learner transcript (fallible; never acoustic ground truth):\n${input.transcript}`;
  const repair = input.repairOf
    ? `\n\nThe previous answer was invalid. Repair it into the exact schema without adding information:\n${input.repairOf.slice(0, 6000)}`
    : "";
  return {
    model: TERRA_MODEL,
    instructions: input.prompt,
    input: [conversation, current, repair].filter(Boolean).join("\n\n"),
    reasoning: { effort: TERRA_REASONING_EFFORT },
    text: {
      format: {
        type: "json_schema",
        name: "tutor_turn_result",
        strict: true,
        schema: TUTOR_TURN_JSON_SCHEMA,
      },
    },
    max_output_tokens: TERRA_MAX_OUTPUT_TOKENS,
  };
}

function responseText(output: unknown): string {
  if (!Array.isArray(output)) return "";
  const chunks: string[] = [];
  for (const item of output) {
    if (typeof item !== "object" || item === null) continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "output_text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        chunks.push((part as { text: string }).text);
      }
    }
  }
  return chunks.join("");
}

export const openAiTerraClient: TerraClient = {
  async complete(input) {
    let response: Response;
    try {
      response = await fetch(RESPONSES_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey()}`,
        },
        body: JSON.stringify(buildTerraRequest(input)),
      });
    } catch (error) {
      throw new TerraUnavailableError(`Network error calling ${TERRA_MODEL}: ${(error as Error).message}`);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new TerraUnavailableError(
        `${TERRA_MODEL} call failed: ${response.status} ${response.statusText} ${body}`.trim(),
      );
    }
    const data = (await response.json()) as {
      id?: unknown;
      status?: unknown;
      output?: unknown;
      usage?: {
        input_tokens?: unknown;
        input_tokens_details?: { cached_tokens?: unknown; cache_write_tokens?: unknown };
        output_tokens?: unknown;
        output_tokens_details?: { reasoning_tokens?: unknown };
      };
    };
    if (data.status !== "completed") {
      throw new TerraUnavailableError(`${TERRA_MODEL} returned status ${String(data.status)}.`);
    }
    return {
      text: responseText(data.output),
      usage: {
        inputTokens: Number(data.usage?.input_tokens) || 0,
        cachedInputTokens: Number(data.usage?.input_tokens_details?.cached_tokens) || 0,
        cacheWriteTokens: Number(data.usage?.input_tokens_details?.cache_write_tokens) || 0,
        outputTokens: Number(data.usage?.output_tokens) || 0,
        reasoningTokens: Number(data.usage?.output_tokens_details?.reasoning_tokens) || 0,
      },
      responseId: typeof data.id === "string" ? data.id : null,
    };
  },
};
