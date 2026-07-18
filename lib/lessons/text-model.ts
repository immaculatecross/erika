// The ONE module that talks to OpenAI's text chat model for E-6 (micro-lessons).
// Everything network-shaped is isolated here behind a typed `TextModelClient`
// interface, so lesson generation, grading, the pattern logic and the budget cap
// are all unit-tested against a mock and no CI test ever makes a real call — the
// same discipline as lib/analysis/audio-model.ts (D-10, WO money-safety).
//
// Text goes in as a chat prompt; the model is asked for structured JSON out. The
// API key is read from the environment at call time and never logged. The model
// id and its token rate live in lib/analysis/rates.ts (the single price knob).

import { TEXT_MODEL } from "../analysis/rates";

/** Thrown when the text model/endpoint is unavailable or unauthorized (a blocker). */
export class TextModelUnavailableError extends Error {}
/** Thrown when a text response cannot be parsed into the expected shape. */
export class TextModelParseError extends Error {}

/** One completion: the reply text plus the token usage that determines its cost. */
export interface TextCompletion {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/** The seam generation and grading depend on. The real impl calls OpenAI; tests mock it. */
export interface TextModelClient {
  /**
   * Send `prompt`, capping the reply at `maxOutputTokens`, and return the text
   * plus token usage. JSON is requested inside the prompt (not response_format),
   * so the caller's parser must tolerate prose/fenced replies — see `extractJsonObject`.
   */
  complete(input: { prompt: string; maxOutputTokens: number }): Promise<TextCompletion>;
}

/**
 * Extract the JSON object from a model reply. The prompt asks for JSON, but chat
 * models often wrap it in a markdown fence or a sentence of prose, so we parse
 * as-is, else the first balanced `{…}` slice (the lesson learned in E-4). Anything
 * else is a truthful parse error. Mirrors `asObject` in audio-model.ts.
 */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const candidates = [raw.trim()];
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new TextModelParseError("Model response was not a JSON object.");
}

// ---- the real OpenAI client ---------------------------------------------

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new TextModelUnavailableError("OPENAI_API_KEY is not set.");
  return key;
}

/** The production client. Kept thin: send prompt → return text + token usage. */
export const openAiTextModel: TextModelClient = {
  async complete({ prompt, maxOutputTokens }) {
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
        body: JSON.stringify({
          model: TEXT_MODEL,
          max_tokens: maxOutputTokens,
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (err) {
      throw new TextModelUnavailableError(`Network error calling ${TEXT_MODEL}: ${(err as Error).message}`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // 4xx around auth/model are legitimate "stop, don't retry-thrash" blockers.
      throw new TextModelUnavailableError(`${TEXT_MODEL} call failed: ${res.status} ${res.statusText} ${body}`.trim());
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new TextModelParseError(`${TEXT_MODEL} returned no message content.`);
    return {
      text: content,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
    };
  },
};
