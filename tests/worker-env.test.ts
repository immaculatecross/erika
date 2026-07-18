import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ENV_LOCAL, loadEnvLocal, parseEnvFile, REQUIRED_KEY, startupEnvError } from "@/lib/env-file";
import { tmpDir } from "./helpers";

// E-16b criterion 1. `npm run worker` is a plain Node process — Next never runs,
// so nothing loaded `.env.local` and the cascade's key was undefined in the ONE
// process that makes the model calls. These cover both halves: the loader
// resolves the key, and a missing key produces the truthful startup error.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function envDir(contents: string): string {
  const dir = tmpDir("erika-env-");
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, ENV_LOCAL), contents);
  return dir;
}

describe("parseEnvFile", () => {
  it("reads plain, exported, quoted, and commented lines", () => {
    expect(
      parseEnvFile(
        [
          "# a comment",
          "",
          "OPENAI_API_KEY=sk-plain",
          "export ERIKA_DB_PATH=/tmp/erika.db",
          'TRIAGE_TEMPO="1.35"',
          "QUOTED='single'",
        ].join("\n"),
      ),
    ).toEqual({
      OPENAI_API_KEY: "sk-plain",
      ERIKA_DB_PATH: "/tmp/erika.db",
      TRIAGE_TEMPO: "1.35",
      QUOTED: "single",
    });
  });

  it("ignores lines that are not KEY=value", () => {
    expect(parseEnvFile("no-equals\n=novalue\n1BAD=x\n")).toEqual({});
  });
});

describe("loadEnvLocal", () => {
  it("resolves the API key into the environment the model client reads", () => {
    const env: Record<string, string | undefined> = {};
    const applied = loadEnvLocal(envDir("OPENAI_API_KEY=sk-from-file\n"), env);
    expect(applied).toEqual([REQUIRED_KEY]);
    expect(env[REQUIRED_KEY]).toBe("sk-from-file");
    expect(startupEnvError(env)).toBeNull();
  });

  it("never overrides a variable already in the environment", () => {
    const env: Record<string, string | undefined> = { OPENAI_API_KEY: "sk-from-shell" };
    expect(loadEnvLocal(envDir("OPENAI_API_KEY=sk-from-file\n"), env)).toEqual([]);
    expect(env[REQUIRED_KEY]).toBe("sk-from-shell");
  });

  it("is a no-op when there is no .env.local (ingest needs no key)", () => {
    const dir = tmpDir("erika-env-");
    dirs.push(dir);
    expect(loadEnvLocal(dir, {})).toEqual([]);
  });
});

describe("startupEnvError", () => {
  it("names the missing variable and the fix", () => {
    const message = startupEnvError({});
    expect(message).toContain(REQUIRED_KEY);
    expect(message).toContain(ENV_LOCAL);
    expect(message).toContain("first model call");
  });

  it("treats a blank key as missing", () => {
    expect(startupEnvError({ OPENAI_API_KEY: "   " })).not.toBeNull();
  });
});
