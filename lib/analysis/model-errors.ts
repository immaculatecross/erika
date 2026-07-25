// The failure vocabulary of a model call — the one piece BOTH the pure reply
// parsers and the network client need, which is why it is its own module rather
// than living in either (E-42: extracting the parsers would otherwise have made a
// circular import, and these classes are used as values, not just as types).
//
// `lib/analysis/audio-model.ts` re-exports all of it, so every existing importer is
// unchanged.

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
