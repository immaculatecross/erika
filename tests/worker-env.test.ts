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

  // E-16 review, advisory 4: `KEY=sk-abc # note` yielded the literal "sk-abc # note".
  // `startupEnvError` saw a non-empty string and let the worker boot, and OpenAI
  // then rejected it as a 401 at the first model call — a silently corrupted secret
  // from a common dotenv habit, waved through by the check that exists to catch it.
  it("strips a trailing comment from an unquoted value", () => {
    expect(parseEnvFile("OPENAI_API_KEY=sk-abc # my key\n")).toEqual({ OPENAI_API_KEY: "sk-abc" });
    expect(parseEnvFile("A=b\t# tabbed\n")).toEqual({ A: "b" });
  });

  it("keeps a # that is part of the value, not a comment", () => {
    // Inside quotes it is data; unquoted with no preceding space it is data too
    // (a secret may legitimately contain one).
    expect(parseEnvFile('A="a # b"\n')).toEqual({ A: "a # b" });
    expect(parseEnvFile("A='a # b'\n")).toEqual({ A: "a # b" });
    expect(parseEnvFile("A=sk-ab#cd\n")).toEqual({ A: "sk-ab#cd" });
  });

  // PR #24 review, advisory 1: two comment shapes still corrupted the value. A
  // QUOTED value with a trailing comment failed the ends-with-quote test and fell
  // into the comment-strip branch, keeping the quote characters ('"sk-abc"'); an
  // EMPTY value with a comment kept the comment text itself ("# note").
  it("strips a trailing comment after a quoted value, quotes and all", () => {
    expect(parseEnvFile('OPENAI_API_KEY="sk-abc" # note\n')).toEqual({ OPENAI_API_KEY: "sk-abc" });
    expect(parseEnvFile("A='v' # note\n")).toEqual({ A: "v" });
    expect(parseEnvFile('A="a # b" # note\n')).toEqual({ A: "a # b" });
  });

  it("an empty value followed by a comment is empty, not the comment text", () => {
    expect(parseEnvFile("KEY= # note\n")).toEqual({ KEY: "" });
    expect(parseEnvFile("KEY=#note\n")).toEqual({ KEY: "" });
    expect(parseEnvFile("KEY=\n")).toEqual({ KEY: "" });
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
