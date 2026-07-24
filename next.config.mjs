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
