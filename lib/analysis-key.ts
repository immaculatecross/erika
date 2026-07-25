// The analysis key, as a fact the whole app can state (E-42 criteria 7 and 9).
//
// Client-safe on purpose — no `node:fs`, no secret ever read here. Only the NAME of
// the variable, the message a refused job carries, and the predicate that recognises
// it. `lib/env-file.ts` (server-only, reads the file) re-exports all of it, so every
// existing importer is unchanged and there is still exactly one definition.
//
// Why producer and predicate share a file: the UI has to tell "no key" apart from
// every other analysis failure, because a missing key is PERMANENT until the learner
// acts and must never be dressed as "unavailable right now" — the copy pattern
// RETRO-004 found thirteen times. Recognising it means matching the message, and a
// matcher that lives away from the message it matches is the "one rule, two
// dialects" defect this repo has shipped twice. So they sit together and a test pins
// them to each other.

/** The variable the analysis cascade cannot run without (lib/analysis/audio-model). */
export const REQUIRED_KEY = "OPENAI_API_KEY";

/** The file the app and the worker both take their secrets from (never committed). */
export const ENV_LOCAL = ".env.local";

/**
 * The message an analysis job carries when it is refused for want of a key. Stored on
 * the job and rendered by the session page, so it is written for the person reading
 * it: what is wrong, that it is permanent until they act, and the exact fix. Never
 * "unavailable right now" — nothing about this server changes on its own, and
 * promising transience makes people retry forever (RETRO-004 §DE-3).
 */
export function analysisUnavailableMessage(): string {
  return `no ${REQUIRED_KEY} is set, so analysis cannot run. Add it to ${ENV_LOCAL} at the repo root (see .env.example), restart the worker, and analyze again. Your recording, its segments and its timeline are already saved.`;
}

/**
 * Is this stored job error OUR OWN refusal for want of a key?
 *
 * EXACT equality, deliberately — not `includes(REQUIRED_KEY)`, which is what this
 * was and which the Full review broke in four ticks. A provider error body is not
 * ours and we do not control its wording: OpenAI's own 401 text mentions the API
 * key, so any transport failure whose body echoed the variable name matched, and
 * `resumeKeylessRefusals` resurrected the job every worker tick — a retry loop on a
 * path this milestone made automatic, which is a re-billing risk, not a cosmetic one.
 *
 * So the predicate is anchored to a fact we control: the exact string
 * `analysisUnavailableMessage()` produces, written by our own worker at the one
 * place it refuses a job. Producer and predicate sit together in this file so they
 * cannot drift, and `tests/capture-flow.test.ts` pins them to each other.
 *
 * The failure mode if the message is ever reworded is safe and visible: an old row
 * stops matching, renders as a plain failure carrying its own truthful text, and is
 * never retried. It degrades to "no automatic recovery", never to a loop.
 */
export function isMissingKeyMessage(error: string | null | undefined): boolean {
  return error === analysisUnavailableMessage();
}
