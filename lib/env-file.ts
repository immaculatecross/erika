import { readFileSync } from "node:fs";
import path from "node:path";
import { ENV_LOCAL, REQUIRED_KEY } from "./analysis-key";

// The worker's environment loader (E-16b criterion 1).
//
// `npm run worker` is a plain Node process — it never goes through Next, which is
// what reads `.env.local` for the app. So `process.env.OPENAI_API_KEY` was
// `undefined` in the ONE process that actually runs the cascade, and every real-API
// smoke to date had called the client directly, so the production path had never
// once been exercised with the real key. The failure surfaced late and obscurely,
// at the first model call, as "OPENAI_API_KEY is not set" inside a job.
//
// An explicit loader is used rather than `node --env-file`: `--env-file` hard-fails
// when the file is absent, and a missing `.env.local` must produce THIS module's
// message ("put it in .env.local, see .env.example") rather than a Node usage
// error about a flag the user never typed. `--env-file-if-exists` would avoid that
// but needs Node 20.12, while the repo's floor is Node 20. A short parser is also
// directly unit-testable, which a runtime flag is not. Documented in the README.
//
// (The original rationale here — "ingest-only runs legitimately have no key file" —
// was true all along, and RETRO-004 §DE-1 restored it. A version of this file briefly
// claimed the opposite because `startupEnvError` exited the worker non-zero without a
// key; that gate is gone. Ingest — normalisation, VAD, hashing, segmenting, duration,
// the timeline — makes ZERO model calls, so a keyless run is the shipped default's
// most important run, not an edge case.)

// The key's name, its refusal message and the predicate that recognises it live in
// lib/analysis-key.ts — client-safe, so the UI can render a permanent condition as
// one — and are re-exported here so every existing importer of this module is
// unchanged. This file keeps the half that genuinely needs the filesystem.
export { ENV_LOCAL, REQUIRED_KEY, analysisUnavailableMessage, isMissingKeyMessage } from "./analysis-key";

/**
 * Parse dotenv-style text into key/value pairs. Deliberately small: `KEY=value`
 * one per line, an optional `export ` prefix, `#` comments (whole-line and
 * trailing), blank lines, and matching single/double quotes stripped from the
 * value. No interpolation, no multi-line values — anything fancier belongs in a
 * real secrets store, not here.
 *
 * Comments next to a value (E-16 review advisory 4; PR #24 review advisory 1): a
 * QUOTED value ends at its closing quote and anything after it — `KEY="sk-abc" #
 * note` — is dropped; inside the quotes a `#` is data (`KEY="a#b"` is `a#b`). An
 * UNQUOTED value is cut at a `#` that starts the value or follows whitespace —
 * `KEY=sk-abc # note` is `sk-abc`, `KEY= # note` is empty — while a `#` inside a
 * token is data (`sk-ab#cd`; a secret may legitimately contain one). Anything
 * less yields a silently corrupted secret from a common dotenv habit, which
 * `hasAnalysisKey` waves through as non-empty and OpenAI rejects as a 401 at the
 * first model call.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line
      .slice(0, eq)
      .replace(/^export\s+/, "")
      .trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    const close = quote === '"' || quote === "'" ? value.indexOf(quote, 1) : -1;
    if (close > 0) {
      // Quoted: the value is what sits inside the pair; a trailing comment (or
      // any other stray text) after the closing quote is not part of it.
      value = value.slice(1, close);
    } else {
      // Unquoted (or an unterminated quote, kept verbatim): a `#` at the start
      // or after whitespace begins a comment; inside a token it is data.
      value = value.replace(/(^|\s)#.*$/, "").trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Apply `.env.local` (if present) to `env`, and return the keys it set. A variable
 * already present in the environment WINS — so `OPENAI_API_KEY=… npm run worker`
 * and CI secrets still override the file. A missing file is not an error: ingest
 * needs no key, and the startup check below is what speaks up when one is needed.
 */
export function loadEnvLocal(
  cwd: string = process.cwd(),
  env: Record<string, string | undefined> = process.env,
): string[] {
  let text: string;
  try {
    text = readFileSync(path.join(cwd, ENV_LOCAL), "utf8");
  } catch {
    return [];
  }
  const applied: string[] = [];
  for (const [key, value] of Object.entries(parseEnvFile(text))) {
    if (env[key] !== undefined) continue;
    env[key] = value;
    applied.push(key);
  }
  return applied;
}


/** Is a usable analysis key present? Blank counts as absent. */
export function hasAnalysisKey(env: Record<string, string | undefined> = process.env): boolean {
  return (env[REQUIRED_KEY] ?? "").trim() !== "";
}

/**
 * The startup NOTICE about a missing key, or null when one is present.
 *
 * [RETRO-004 §DE-1] This used to be `startupEnvError`, and the worker exited 1 on it.
 * That made the app's own instruction a closed loop: an upload sat at `Queued 0%`, the
 * session page correctly said "start the worker with `npm run worker`", the user ran
 * it, it printed two lines and quit, and nothing changed — with no way out from inside
 * the product. The gate was also aimed at the wrong stage: ingest makes zero model
 * calls, so it was a blanket startup check protecting work that runs much later.
 *
 * So this is a notice, not an error. The worker prints it and carries on draining the
 * ingest queue; only an ANALYSIS job is refused, terminally and per-job, at the point
 * a model call is actually required (`analysisUnavailableMessage`). It is returned
 * rather than printed so it stays testable.
 */
export function startupKeyNotice(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (hasAnalysisKey(env)) return null;
  return [
    `[worker] ${REQUIRED_KEY} is not set — ingest will run normally; analysis is unavailable.`,
    `[worker] Recordings will be segmented and their timeline built. To analyze them, put the key in`,
    `[worker] ${ENV_LOCAL} at the repo root (see .env.example) and restart the worker.`,
  ].join("\n");
}
