import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// E-16b criterion 7: the pre-commit gate that blocks a raw NUL byte in a source
// file. RETRO-001 demonstrated the failure — git serves a NUL-bearing file as
// binary, so `git diff` shows "Binary files differ" and the content bypasses
// review entirely while lint, types, tests and the tripwire scan all pass.
//
// This drives the real hook in a throwaway git repo: it is a shell script, so
// asserting on its source would prove nothing about whether it fires.

const HOOKS = path.join(__dirname, "..", ".mfactory", "hooks");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A git repo with the real hooks bundle copied in, and `file` staged. */
function stagedRepo(file: string, contents: Buffer | string): string {
  const dir = tmpDir("erika-hook-");
  dirs.push(dir);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  fs.cpSync(HOOKS, path.join(dir, ".mfactory", "hooks"), { recursive: true });
  fs.writeFileSync(path.join(dir, file), contents);
  git("add", file);
  return dir;
}

function runHook(dir: string): { code: number; stderr: string } {
  const r = spawnSync(path.join(dir, ".mfactory", "hooks", "pre-commit"), [], {
    cwd: dir,
    encoding: "utf8",
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? "" };
}

describe("pre-commit NUL-byte gate", () => {
  it("blocks a staged source file carrying a raw NUL byte", () => {
    const poisoned = Buffer.concat([
      Buffer.from("export const ok = 1;\n"),
      Buffer.from([0x00]),
      Buffer.from("export const hidden = 2;\n"),
    ]);
    const { code, stderr } = runHook(stagedRepo("evil.ts", poisoned));
    expect(code).toBe(1);
    expect(stderr).toMatch(/raw NUL byte/);
    expect(stderr).toMatch(/evil\.ts/);
  });

  it("lets ordinary source through", () => {
    const { code, stderr } = runHook(stagedRepo("fine.ts", "export const ok = 1;\n"));
    expect(stderr).not.toMatch(/NUL/);
    expect(code).toBe(0);
  });

  it("does not block non-source files, which are legitimately binary", () => {
    // Audio fixtures and images are full of NUL bytes; the rule is about source.
    const { code, stderr } = runHook(stagedRepo("sample.wav", Buffer.from([0x52, 0x00, 0x00, 0x46])));
    expect(stderr).not.toMatch(/NUL/);
    expect(code).toBe(0);
  });
});
