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
/** Thrown when a text request exceeds the bound that protects its spend claim. */
export class TextModelTimeoutError extends TextModelUnavailableError {}
/** Thrown when a text response cannot be parsed into the expected shape. */
export class TextModelParseError extends Error {}

/**
 * [E-45] Thrown when the reply was CUT OFF at the token ceiling rather than finished.
 *
 * This is a distinct failure from `TextModelParseError` and conflating them cost the
 * learner money. A live probe found an item-lesson call that resolved, was billed, and
 * produced no lesson: the reply came back `finish_reason: "length"`, so it was a half
 * a JSON object, `extractJsonObject` failed on it, and the route answered "the lesson
 * model returned an unreadable response" — which is not what happened and gives nobody
 * anything to do. Reproduced here at a forced 200-token ceiling: 6 of 6 replies came
 * back `length` and 6 of 6 failed to parse.
 *
 * Naming it separately is what makes the E-16 bounded repair possible: "you ran out of
 * room, answer more briefly" is a request a model can actually satisfy, where "that was
 * unreadable" is not.
 */
export class TextModelTruncatedError extends Error {}

/** One completion: the reply text plus the token usage that determines its cost. */
export interface TextCompletion {
  text: string;
  promptTokens: number;
  completionTokens: number;
  /**
   * The provider's stop reason — `"length"` means the reply was cut off, not finished.
   *
   * The real client used to DISCARD this field, which is the whole root cause above:
   * with it thrown away, a truncated reply is indistinguishable from a malformed one.
   * Optional so a hand-built mock without it behaves exactly as before (absent is
   * simply "we were not told"), never so a real truncation can pass unnoticed.
   */
  finishReason?: string | null;
}

/** Whether a resolved completion was cut off at the ceiling. */
export function wasTruncated(completion: TextCompletion): boolean {
  return completion.finishReason === "length";
}

/** The seam generation and grading depend on. The real impl calls OpenAI; tests mock it. */
export interface TextModelClient {
  /**
   * Send `prompt`, capping the reply at `maxOutputTokens`, and return the text
   * plus token usage. JSON is requested inside the prompt (not response_format),
   * so the caller's parser must tolerate prose/fenced replies — see `extractJsonObject`.
   */
  complete(input: { prompt: string; maxOutputTokens: number; signal?: AbortSignal }): Promise<TextCompletion>;
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
  async complete({ prompt, maxOutputTokens, signal }) {
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
        signal,
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
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== "string") throw new TextModelParseError(`${TEXT_MODEL} returned no message content.`);
    return {
      text: content,
      promptTokens: json.usage?.prompt_tokens ?? 0,
      completionTokens: json.usage?.completion_tokens ?? 0,
      // Carried, not discarded (E-45). See `TextModelTruncatedError`.
      finishReason: choice?.finish_reason ?? null,
    };
  },
};
