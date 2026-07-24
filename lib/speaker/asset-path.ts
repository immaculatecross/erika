import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bundler-safe resolver for the on-device speaker model asset (E-36), the exact
// discipline lib/lexicon/asset-path.ts uses for the committed lexicon (#47). The
// sherpa-onnx embedding model (~29 MB .onnx) is NOT committed — it is operator-
// installed (large binary; see lib/speaker/sherpa-embedder.ts) — so this only
// answers "where would it be on disk?" in every execution context.
//
// WHY NOT `fileURLToPath(new URL("./model.onnx", import.meta.url))`? Under Next's
// WEBPACK SERVER BUNDLE that literal-argument form is REWRITTEN by webpack's asset
// handling into a browser asset URL, and `fileURLToPath` then throws — the exact
// failure that 500'd a fresh DB in #47. The trigger is the `new URL(<string
// literal>, import.meta.url)` shape specifically, so we never use it: we resolve
// module-relative first (cwd-independent in vitest/tsx/node) and fall back to the
// project root (where next.config's `outputFileTracingIncludes` copies a model into
// a standalone build, preserving its repo-relative path).

/** Absolute path to a speaker asset given its repo-relative path (e.g.
 *  `"lib/speaker/models/campplus.onnx"`). Module-relative when resolvable
 *  (cwd-independent), else against the project root — never via
 *  `new URL(..., import.meta.url)`. Existence is the caller's concern. */
export function speakerAssetPath(repoRelativePath: string): string {
  const rel = repoRelativePath.replace(/^\.?\/*/, "");
  try {
    const hereDir = path.dirname(fileURLToPath(import.meta.url)); // .../lib/speaker
    const beside = path.join(hereDir, path.relative("lib/speaker", rel));
    if (fs.existsSync(beside)) return beside;
  } catch {
    // `import.meta.url` is not a usable file URL in this realm (webpack bundle) —
    // fall through to the project-root resolution below.
  }
  return path.join(process.cwd(), rel);
}
