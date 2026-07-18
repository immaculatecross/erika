import { readFileSync } from "node:fs";
import path from "node:path";

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
// when the file is absent (ingest-only runs legitimately have no key file), and
// `--env-file-if-exists` needs Node 20.12 while the repo's floor is Node 20. A
// twenty-line parser is also directly unit-testable, which a runtime flag is not.
// Documented in the README.

/** The file the app and the worker both take their secrets from (never committed). */
export const ENV_LOCAL = ".env.local";

/**
 * Parse dotenv-style text into key/value pairs. Deliberately small: `KEY=value`
 * one per line, an optional `export ` prefix, `#` comments, blank lines, and
 * matching single/double quotes stripped from the value. No interpolation, no
 * multi-line values — anything fancier belongs in a real secrets store, not here.
 */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
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
export function loadEnvLocal(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): string[] {
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

/** The variable the analysis cascade cannot run without (lib/analysis/audio-model). */
export const REQUIRED_KEY = "OPENAI_API_KEY";

/**
 * The startup complaint, or null when the environment is usable. Returned rather
 * than thrown so it is testable without a process exit; the worker prints it and
 * exits non-zero, which is the whole point — failing at boot with the fix in the
 * message beats failing later inside a job with "OPENAI_API_KEY is not set".
 */
export function startupEnvError(env: NodeJS.ProcessEnv = process.env): string | null {
  if ((env[REQUIRED_KEY] ?? "").trim() !== "") return null;
  return [
    `[worker] ${REQUIRED_KEY} is not set — analysis jobs would fail at the first model call.`,
    `[worker] Put it in ${ENV_LOCAL} at the repo root (see .env.example), then run \`npm run worker\` again.`,
  ].join("\n");
}
