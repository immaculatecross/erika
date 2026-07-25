import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  analysisUnavailableMessage,
  ENV_LOCAL,
  hasAnalysisKey,
  loadEnvLocal,
  parseEnvFile,
  REQUIRED_KEY,
  startupKeyNotice,
} from "@/lib/env-file";
import { tmpDir } from "./helpers";

// E-16b criterion 1. `npm run worker` is a plain Node process — Next never runs,
// so nothing loaded `.env.local` and the cascade's key was undefined in the ONE
// process that makes the model calls. These cover both halves: the loader
// resolves the key, and a missing key produces a truthful startup NOTICE.
//
// [RETRO-004 §DE-1] The notice used to be an ERROR the worker exited 1 on, which
// made a keyless install unable to ingest anything, ever. Ingest makes zero model
// calls, so the tests below now assert the opposite of what they once did: a missing
// key must NOT read as a fatal condition, and the message must promise ingest.

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
  // `hasAnalysisKey` saw a non-empty string and let the cascade run, and OpenAI
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
    expect(startupKeyNotice(env)).toBeNull();
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

describe("hasAnalysisKey", () => {
  it("is false when absent or blank, true for a real value", () => {
    expect(hasAnalysisKey({})).toBe(false);
    expect(hasAnalysisKey({ OPENAI_API_KEY: "   " })).toBe(false);
    expect(hasAnalysisKey({ OPENAI_API_KEY: "sk-abc" })).toBe(true);
  });
});

describe("startupKeyNotice (RETRO-004 \u00a7DE-1)", () => {
  it("names the missing variable and the fix", () => {
    const message = startupKeyNotice({});
    expect(message).toContain(REQUIRED_KEY);
    expect(message).toContain(ENV_LOCAL);
  });

  it("promises that ingest still runs, and never claims the worker is stopping", () => {
    const message = startupKeyNotice({})!;
    // The founding loop must be reachable keyless; the notice has to say so, because
    // the previous message ("analysis jobs would fail at the first model call", then
    // exit 1) told the user the opposite of what is now true.
    expect(message).toMatch(/ingest will run/i);
    expect(message).toMatch(/analysis is unavailable/i);
    expect(message).not.toMatch(/exit|abort|stopping/i);
  });

  it("is null when a key is present", () => {
    expect(startupKeyNotice({ OPENAI_API_KEY: "sk-abc" })).toBeNull();
  });
});

describe("analysisUnavailableMessage \u2014 the per-job wall", () => {
  it("states the permanent cause, the exact fix, and that the recording is safe", () => {
    const m = analysisUnavailableMessage();
    expect(m).toContain(REQUIRED_KEY);
    expect(m).toContain(ENV_LOCAL);
    expect(m).toMatch(/segments/i);
    // Never "right now": nothing about this server changes on its own, and promising
    // transience for a permanent, user-fixable condition makes people retry forever.
    expect(m).not.toMatch(/right now|just now|temporar/i);
  });
});
