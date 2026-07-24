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
    "/**": ["./lib/lexicon/*.tsv.gz"],
  },
};

export default nextConfig;
