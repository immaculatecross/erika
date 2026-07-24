/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 is a native module — keep it external to the server bundle.
  serverExternalPackages: ["better-sqlite3"],
  // The committed lexicon assets are read from disk at runtime (resolved against
  // the project root, see lib/lexicon/asset-path.ts). A standalone build runs with
  // cwd = the standalone dir, so trace these .tsv.gz files into that output,
  // preserving their repo-relative path — the E-28 "traceable into standalone"
  // intent. (For `next dev`/`next start` from the repo root the source assets are
  // already present; this matters only for `output: "standalone"`.)
  outputFileTracingIncludes: {
    // The lexicon assets (E-28) and, when the operator installs it, the on-device
    // speaker model (E-36) — both read from disk at runtime via the #47-safe
    // module-relative-then-project-root discipline. Tracing them preserves their
    // repo-relative path into a standalone build. The .onnx glob matches nothing in
    // the repo (the ~29 MB model is operator-installed, never committed) and is
    // harmless when absent; it arms the standalone trace the moment a model is dropped in.
    "/**": ["./lib/lexicon/*.tsv.gz", "./lib/speaker/models/*.onnx"],
  },
  // The two-tab shell (E-30). Record is the home tab (`/`) and Learn's home is
  // the daily plan (`/practice`); `/record` and `/learn` are convenience aliases
  // for the tab names so those deep links resolve too. Every OTHER existing path
  // stays in place — no page moved, so nothing else needs a redirect (the E-30
  // contract: no deep link 404s). Kept non-permanent: these are UI conveniences,
  // not a canonical URL change, so they stay cheap to revise.
  async redirects() {
    return [
      { source: "/record", destination: "/", permanent: false },
      { source: "/learn", destination: "/practice", permanent: false },
    ];
  },
};

export default nextConfig;
