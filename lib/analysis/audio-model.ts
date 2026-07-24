import { isCategory, isSeverity, sanitizeNotes, type NewFinding } from "./findings";
import type { SpeakerProfile } from "./profile";
import { MINI_MODEL, type ModelId } from "./rates";
import {
  triagePrompt,
  deepPrompt,
  recastRegisterInstruction,
  STRICT_JSON_INSTRUCTION,
  DOMINANT_SPEAKER_INSTRUCTION,
  RECURRENCE_INSTRUCTION,
  ENRICHED_NOTES_INSTRUCTION,
  PRODUCED_LEMMAS_INSTRUCTION,
} from "./prompts";
import { DEFAULT_REGISTER, type Register } from "../register";

// Prompt builders live in ./prompts (500-line hook); re-exported here so the
// cascade and the criterion-tests keep importing them from audio-model.
export {
  triagePrompt,
  deepPrompt,
  recastRegisterInstruction,
  STRICT_JSON_INSTRUCTION,
  DOMINANT_SPEAKER_INSTRUCTION,
  RECURRENCE_INSTRUCTION,
  ENRICHED_NOTES_INSTRUCTION,
  PRODUCED_LEMMAS_INSTRUCTION,
};

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
  /** The speaker profile the prompt is primed with (E-19). Optional: absent
   *  behaves exactly as before the profile existed. */
  profile?: SpeakerProfile;
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
  /** The speaker profile the prompt is primed with (E-19). Optional: absent
   *  behaves exactly as before the profile existed. */
  profile?: SpeakerProfile;
  /** The register the CORRECTION voice is phrased in (E-33, D-23). Optional:
   *  absent defaults to colto, exactly as before the dial existed. */
  register?: Register;
}

/** One correctly-produced (lemma, POS) the deep pass reports the speaker using
 *  well (E-28, D-19). The POS is the model's claim in the knowledge scheme; both
 *  are validated against morph-it before any evidence is written — an unattested
 *  pair is dropped, never minted (lib/analysis/produced-lemmas.ts). */
export interface ProducedLemma {
  lemma: string;
  pos: string;
}

export interface DeepResult {
  /** Findings with offsets *relative to the segment start*, in ms. `recurrenceId`
   *  is the model's optional claim that a finding recurs a numbered profile entry
   *  ("R1"…); it is advisory — the cascade resolves it, and an unknown id is
   *  simply ignored (D-13). `notes` is the optional enriched channel (E-28). */
  findings: (NewFinding & { relStartMs?: number; relEndMs?: number; recurrenceId?: string })[];
  /** Correctly-produced lemmas the speaker used well (E-28) — positive production
   *  evidence, morph-it-validated downstream. Optional: the parser always sets it
   *  (possibly []), but a hand-built `DeepResult` (a test mock) may omit it, in
   *  which case there is simply no produced evidence. */
  produced?: ProducedLemma[];
}

/**
 * Output-token ceilings for the two calls. The deep ceiling is generous (E-28): the
 * enriched reply now also carries `notes` and a `produced` list, so a small budget
 * would clip a real answer and trip the truncation-repair path on every rich
 * segment. Raising it keeps the E-16 truncation repair (`ModelTruncatedError` +
 * one strict retry) RARE rather than removing it — a genuinely runaway reply still
 * hits the ceiling and is repaired. Triage answers one boolean, so its ceiling
 * stays tight, which also bounds a mini stuck in a bad mode.
 */
export const DEEP_MAX_OUTPUT_TOKENS = 4000;
export const TRIAGE_MAX_OUTPUT_TOKENS = 400;

/** Per-call knobs the cascade uses for its one bounded repair retry. */
export interface CallOpts {
  /**
   * Re-ask with a stricter JSON-only instruction. Set only on the retry after an
   * unparseable reply — a model that wrapped its answer in prose usually complies
   * when told plainly, and one retry bounds the cost of finding out.
   */
  strictJson?: boolean;
}

/** The seam the cascade depends on. The real impl calls OpenAI; tests mock it. */
export interface AudioModelClient {
  triage(input: TriageInput, opts?: CallOpts): Promise<TriageResult>;
  deepListen(model: ModelId, input: DeepInput, opts?: CallOpts): Promise<DeepResult>;
}

/** Thrown when a model/endpoint is unavailable or unauthorized (a real blocker). */
export class ModelUnavailableError extends Error {}
/**
 * A 429 / rate-limit response (E-27 criterion 5). Internal to this module: the
 * client retries it a bounded number of times with jittered backoff honoring any
 * `Retry-After`, and only if the retries are exhausted does it surface — as a
 * `ModelUnavailableError`, so the cascade tries the D-3 fallback and, having
 * received no completion, reserves and charges nothing. `retryAfterMs` is the
 * server's requested wait, when it sent one.
 */
export class ModelRateLimitError extends Error {
  retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}
/**
 * Thrown when a model response cannot be parsed into the expected shape.
 *
 * `shape` is a structural, content-free description of what came back
 * (`describeResponseShape`) — persisted with the segment so the failure
 * distribution becomes visible without storing the reply itself.
 */
export class ModelParseError extends Error {
  shape?: string;
}
/**
 * The reply stopped because it hit the token limit (E-16b criterion 4). Almost
 * certainly the operator's actual "Model response was not a JSON object": a
 * deep-listen answer cut off mid-array is not a parse *disagreement*, it is a
 * truncation, and calling it the former sent every reader looking in the wrong
 * place. A subclass of ModelParseError so it inherits the same handling — the
 * call resolved, so it was billed, and one repair retry is still worth trying.
 */
export class ModelTruncatedError extends ModelParseError {}

/**
 * A content-free description of a bad reply: what stopped it, how long it was, and
 * whether it contained anything object-shaped at all. Deliberately carries no text
 * from the response — the point is to see the distribution of failures, not to
 * archive model output (or anything the speaker said) in the database.
 */
export function describeResponseShape(raw: string, finishReason: string | null): string {
  const parts = [
    `finish_reason=${finishReason ?? "none"}`,
    `chars=${raw.length}`,
    `brace=${raw.includes("{") ? (raw.trimEnd().endsWith("}") ? "closed" : "unclosed") : "none"}`,
  ];
  return parts.join(" ");
}

// ---- pure parsers (tested directly) -------------------------------------

/**
 * Extract the JSON object from a model response. These audio models do not
 * support a JSON response_format, so we instruct JSON in the prompt and tolerate
 * a stray markdown fence or surrounding prose: parse as-is, else the first
 * balanced `{…}` slice. Anything else is a truthful parse error.
 */
function asObject(raw: string): Record<string, unknown> {
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
  throw new ModelParseError("Model response was not a JSON object.");
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
    // Optional everywhere (D-13): a missing, empty, or non-string recurrenceId is
    // simply absent — it can never fail the finding, the segment, or the run.
    const recurrenceId =
      typeof f.recurrenceId === "string" && f.recurrenceId.trim() !== ""
        ? f.recurrenceId.trim()
        : undefined;
    // The enriched channel is optional and defensively sanitized (E-28): a
    // malformed or over-generous `notes` object keeps only the three known string
    // fields, and reduces to null otherwise — it never fails the finding.
    const notes = sanitizeNotes(f.notes);
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
      recurrenceId,
      notes,
    };
  });
  return { findings, produced: parseProduced(obj.produced) };
}

/**
 * Extract the optional `produced` lemma list (E-28) defensively: a missing,
 * non-array, or partly-malformed value yields the valid entries only, never an
 * error. Each entry needs a non-empty `lemma` and a `pos` string; morph-it
 * validation (drop of an unattested pair) happens downstream, not here — this
 * layer only shapes the reply. A garbage `produced` can never fail the segment or
 * the run (E-16 d4 / D-13), exactly like `notes`.
 */
export function parseProduced(raw: unknown): ProducedLemma[] {
  if (!Array.isArray(raw)) return [];
  const out: ProducedLemma[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as Record<string, unknown>;
    const lemma = typeof r.lemma === "string" ? r.lemma.trim() : "";
    const pos = typeof r.pos === "string" ? r.pos.trim() : "";
    if (lemma !== "" && pos !== "") out.push({ lemma, pos });
  }
  return out;
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

// ---- bounded, jittered 429 retry (E-27 criterion 5) ----------------------

/** How many times a 429 is retried before it surfaces as ModelUnavailableError. */
export const RATE_LIMIT_RETRIES = 4;
const RATE_LIMIT_BASE_MS = 500;
const RATE_LIMIT_MAX_MS = 20_000;
/** Fraction of the base delay added as random jitter, so a fleet of racing pool
 *  workers that all got 429'd do not retry in lockstep (thundering herd). */
const RATE_LIMIT_JITTER = 0.5;

/** Parse a `Retry-After` header (delta-seconds or an HTTP-date) into ms, or undefined. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const secs = Number(header.trim());
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs * 1000));
  const when = Date.parse(header);
  return Number.isFinite(when) ? Math.max(0, when - now) : undefined;
}

/** The backoff for attempt `n` (0-based): exponential, capped, never below a
 *  server-requested `Retry-After`, plus jitter. */
export function backoffDelay(
  attempt: number,
  retryAfterMs: number | undefined,
  opts: { baseMs?: number; maxMs?: number; random?: () => number } = {},
): number {
  const baseMs = opts.baseMs ?? RATE_LIMIT_BASE_MS;
  const maxMs = opts.maxMs ?? RATE_LIMIT_MAX_MS;
  const random = opts.random ?? Math.random;
  const capped = Math.min(maxMs, baseMs * 2 ** attempt);
  const floor = Math.max(capped, retryAfterMs ?? 0);
  return Math.round(floor + floor * RATE_LIMIT_JITTER * random());
}

export interface RateLimitRetryOpts {
  retries?: number;
  baseMs?: number;
  maxMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/**
 * Run `fn`, retrying only `ModelRateLimitError` up to `retries` times with jittered
 * backoff that honors any `Retry-After`. Any other error propagates immediately.
 * Exhausting the retries throws `ModelUnavailableError` — no completion was ever
 * received, so the caller (the cascade) reserves and charges nothing and tries the
 * D-3 fallback. `sleep`/`random` are injectable so tests are deterministic and
 * never wait on a real clock.
 */
export async function retryOnRateLimit<T>(fn: () => Promise<T>, opts: RateLimitRetryOpts = {}): Promise<T> {
  const retries = opts.retries ?? RATE_LIMIT_RETRIES;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ModelRateLimitError)) throw err;
      if (attempt >= retries) {
        throw new ModelUnavailableError(`Rate limited: exhausted ${retries} retries. ${err.message}`);
      }
      await sleep(backoffDelay(attempt, err.retryAfterMs, opts));
    }
  }
}

interface RawReply {
  content: string;
  /** OpenAI's stop reason — "length" means the reply was cut off, not finished. */
  finishReason: string | null;
}

async function callModelOnce(
  model: ModelId,
  prompt: string,
  input: TriageInput | DeepInput,
  maxOutputTokens: number,
): Promise<RawReply> {
  let res: Response;
  try {
    res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify({
        // These audio models take audio in and return text; they do not support a
        // JSON response_format, so JSON is requested in the prompt and extracted
        // by the parser. `modalities: ["text"]` keeps the reply text-only.
        // `max_completion_tokens` caps the reply — generous on deep so the enriched
        // answer is not clipped into the truncation-repair path (E-28), tight on triage.
        model,
        modalities: ["text"],
        max_completion_tokens: maxOutputTokens,
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
  // A 429 is transient: surface it as a retryable rate-limit error carrying any
  // server-requested wait, so the retry wrapper backs off rather than giving up.
  if (res.status === 429) {
    throw new ModelRateLimitError(`${model} rate limited (429).`, parseRetryAfter(res.headers.get("retry-after")));
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const msg = `${model} call failed: ${res.status} ${res.statusText} ${body}`.trim();
    // Other 4xx around auth/model are legitimate "stop, don't retry-thrash" blockers.
    throw new ModelUnavailableError(msg);
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  };
  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason ?? null;
  if (typeof content !== "string") throw new ModelParseError(`${model} returned no message content.`);
  return { content, finishReason };
}

/** One model call, transparently retrying a 429 with jittered, Retry-After-honoring
 *  backoff (E-27 criterion 5). The retries are invisible to the cascade — one call
 *  in, one completion out — so a call reserves and bills exactly once regardless of
 *  how many 429s it weathered. */
async function callModel(
  model: ModelId,
  prompt: string,
  input: TriageInput | DeepInput,
  maxOutputTokens: number,
): Promise<RawReply> {
  return retryOnRateLimit(() => callModelOnce(model, prompt, input, maxOutputTokens));
}

/**
 * Turn one raw reply into a parsed result, or into a truthful, shape-carrying
 * error. Truncation is checked BEFORE parsing: a cut-off reply usually also fails
 * to parse, and "the model ran out of room" is the useful message, not "that was
 * not a JSON object".
 */
function interpret<T>(model: ModelId, reply: RawReply, parse: (raw: string) => T): T {
  const shape = describeResponseShape(reply.content, reply.finishReason);
  if (reply.finishReason === "length") {
    const err = new ModelTruncatedError(`${model} reply was cut off at the token limit (${shape}).`);
    err.shape = shape;
    throw err;
  }
  try {
    return parse(reply.content);
  } catch (err) {
    if (err instanceof ModelParseError) err.shape = shape;
    throw err;
  }
}

const strict = (prompt: string, opts?: CallOpts): string =>
  opts?.strictJson ? `${prompt} ${STRICT_JSON_INSTRUCTION}` : prompt;

/** The production client. Kept thin: build prompt → call → hand off to a parser. */
export const openAiAudioModel: AudioModelClient = {
  async triage(input, opts) {
    const prompt = strict(triagePrompt(input.targetLanguage, input.profile), opts);
    return interpret(MINI_MODEL, await callModel(MINI_MODEL, prompt, input, TRIAGE_MAX_OUTPUT_TOKENS), parseTriageResponse);
  },
  async deepListen(model, input, opts) {
    const prompt = strict(deepPrompt(input.targetLanguage, input.profile, input.register ?? DEFAULT_REGISTER), opts);
    return interpret(model, await callModel(model, prompt, input, DEEP_MAX_OUTPUT_TOKENS), parseDeepResponse);
  },
};
