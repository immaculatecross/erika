import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lexiconAssetPath } from "@/lib/lexicon/asset-path";
import { ASSET_PATH as FREQ_ASSET } from "@/lib/lexicon/frequency-lexicon";
import { ASSET_PATH as MORPHIT_ASSET } from "@/lib/lexicon/morphit";

// Regression guard for WO-asset-loader-bundler-fix (the v0.4 cold-start blocker).
//
// THE DEFECT: both lexicon loaders resolved their asset with
// `fileURLToPath(new URL("./…", import.meta.url))`. Under Next's WEBPACK SERVER
// BUNDLE that expression is rewritten by webpack's asset-module handling into a
// BROWSER ASSET URL (`/_next/static/media/…`), not a filesystem path, so
// `fileURLToPath` threw and the v17 seed 500'd the first time a migration ran
// inside the bundled server (a fresh user's very first DB-touching request).
//
// THE FIX: `lexiconAssetPath` resolves the asset BESIDE its module when possible
// (cwd-independent, via bare `import.meta.url`, which webpack does NOT rewrite) and
// falls back to `process.cwd()` + the repo-relative path for the bundle — never
// through `new URL(..., import.meta.url)`, so webpack never rewrites it.
//
// WHAT THESE TESTS COVER: (1) the resolver returns an absolute path to the real
// committed asset on disk; (2) it stays resolvable when cwd is NOT the repo (the
// E-28 guarantee); (3) a source-level guard that neither the loaders nor the helper
// reintroduce the webpack-hijacked `new URL(..., import.meta.url)` asset pattern.
//
// WHAT THEY DO NOT COVER: vitest runs in Node's own realm from the repo root, so it
// CANNOT reproduce webpack's asset-module rewrite. Guard (3) is the cheap reliable
// proxy that would have caught this class of defect at review; the only true
// end-to-end guard is the cold-start walkthrough (a fresh `npm run dev` hitting a DB
// route runs v17 inside the real bundle). The durable fix for that gate-gap is a CI
// smoke-boot of the built server hitting a DB route — proposed as a follow-up,
// deliberately not built here.

describe("lexiconAssetPath — bundler-safe asset resolution", () => {
  it("resolves both committed assets to absolute paths that exist on disk", () => {
    for (const rel of [FREQ_ASSET, MORPHIT_ASSET]) {
      const resolved = lexiconAssetPath(rel);
      expect(path.isAbsolute(resolved)).toBe(true);
      expect(resolved.endsWith(path.basename(rel))).toBe(true);
      expect(fs.existsSync(resolved)).toBe(true);
      expect(fs.statSync(resolved).size).toBeGreaterThan(0);
    }
  });

  it("stays resolvable when process.cwd() is NOT the repo (the E-28 guarantee)", () => {
    const original = process.cwd();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "erika-assetpath-"));
    try {
      process.chdir(elsewhere); // a cwd where a bare cwd-relative read would ENOENT
      for (const rel of [FREQ_ASSET, MORPHIT_ASSET]) {
        expect(fs.existsSync(lexiconAssetPath(rel))).toBe(true); // module-relative still finds it
      }
    } finally {
      process.chdir(original);
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("never resolves via the webpack-hijacked `new URL(..., import.meta.url)` pattern", () => {
    // That pattern is exactly what broke under the server bundle. Scanning source
    // (comments stripped, so the explanatory notes that NAME the pattern don't trip
    // the guard) keeps a reviewer and any future refactor from reintroducing it — a
    // failure vitest itself cannot see because it runs outside the webpack realm.
    for (const rel of ["lib/lexicon/asset-path.ts", "lib/lexicon/frequency-lexicon.ts", "lib/lexicon/morphit.ts"]) {
      const code = stripComments(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
      expect(code.includes("new URL")).toBe(false); // no webpack asset-module rewrite
    }
    // And the loaders delegate to the audited shared resolver.
    for (const rel of ["lib/lexicon/frequency-lexicon.ts", "lib/lexicon/morphit.ts"]) {
      const code = stripComments(fs.readFileSync(path.join(process.cwd(), rel), "utf8"));
      expect(code.includes("lexiconAssetPath")).toBe(true);
    }
  });
});

/** Strip `//` line and block comments so a source scan sees code only. Good enough
 *  for these small, string-literal-free modules. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
