import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Shared, bundler-safe resolver for the committed lexicon assets (the frequency
// lexicon + the morph-it validator). Both loaders read a gzipped `.tsv.gz` that
// ships in the repo, beside THIS module in `lib/lexicon/`; this answers "where is
// it on disk?" in every execution context.
//
// WHY NOT `fileURLToPath(new URL("./…", import.meta.url))` (the old E-28 approach)?
// Under Next's WEBPACK SERVER BUNDLE the expression `new URL(<string literal>,
// import.meta.url)` is not a filesystem reference — webpack's asset-module handling
// REWRITES it into a browser asset URL, emitting the file under `.next/static/media/`
// and returning `/_next/static/media/frequency-lexicon.tsv.<hash>.gz`. Passing that
// to `fileURLToPath` throws — `ERR_INVALID_ARG_TYPE` (webpack's polyfilled URL isn't
// `instanceof` node:url's URL) or `Invalid URL` (the href is a bare web path). Either
// way there is no file path to recover, so the v17 seed 500'd the first time a
// migration ran inside the bundled server (a fresh user's first DB-touching request).
// The trigger is the `new URL(literal, import.meta.url)` shape specifically, so we
// never use it.
//
// RESOLUTION — module-relative first, project-root fallback:
//   1. Beside this module. In NON-bundled realms (vitest, tsx, node — how tests and
//      scripts/CI run) `import.meta.url` is this source file, so the asset resolves
//      next to it INDEPENDENT of process.cwd() — the E-28 guarantee (the asset stays
//      resolvable when cwd is not the repo). Bare `import.meta.url` is NOT the
//      asset-rewrite trigger, so webpack leaves it as the module's real URL.
//   2. Project root. Under the webpack server bundle `import.meta.url` points into
//      `.next/server/…`, where the asset does not sit beside the chunk, so step 1
//      misses and we fall back to `process.cwd()` + the repo-relative path — the repo
//      root for `next dev`/`next start`, and the standalone root for a standalone
//      build, where `outputFileTracingIncludes` in next.config copies these assets
//      preserving their repo-relative path. This keeps the E-28 "traced into
//      standalone" intent while never depending on cwd where a module-relative read
//      can answer.

/**
 * Absolute filesystem path to a committed lexicon asset, given its repo-relative
 * path (e.g. `"lib/lexicon/frequency-lexicon.tsv.gz"`). Resolves beside this module
 * when possible (cwd-independent), else against the project root — never via
 * `new URL(..., import.meta.url)` (see the module note on why that is unusable under
 * Next's webpack server bundle).
 */
export function lexiconAssetPath(repoRelativePath: string): string {
  const basename = path.basename(repoRelativePath);
  try {
    const beside = path.join(path.dirname(fileURLToPath(import.meta.url)), basename);
    if (fs.existsSync(beside)) return beside;
  } catch {
    // `import.meta.url` is not a usable file URL in this realm (webpack bundle) —
    // fall through to the project-root resolution below.
  }
  return path.join(process.cwd(), repoRelativePath);
}
