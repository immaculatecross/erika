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
 * Does a stored job error mean "there is no API key"? Used by the sessions list and
 * the session page to render a permanent condition as one — with the fix beside it —
 * instead of a generic failure the learner is invited to retry into a loop.
 */
export function isMissingKeyMessage(error: string | null | undefined): boolean {
  return typeof error === "string" && error.includes(REQUIRED_KEY);
}
