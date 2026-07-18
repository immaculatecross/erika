# Erika

Master the language you already speak. Local-first web app: give it your real speech — a mic take or a day-long dump from an always-on recorder; Erika extracts the moments you're talking, a native-audio model inventories your mistakes, and they become flashcards, micro-lessons, and a focus map. The curriculum is you.

- **PRODUCT.md** — what this is and why.
- **DESIGN.md** — the binding design constitution.
- **FEATURES.md** — milestones and what's next.
- **DECISIONS.md** — settled calls.
- **docs/schema.md** — the database, table by table, and the migration history.

## Setup

Prerequisites: Node 20+, `ffmpeg`/`ffprobe` on PATH.

```sh
cp .env.example .env.local        # add your OpenAI API key (gpt-audio access)
git config core.hooksPath .mfactory/hooks
npm install
npm run dev                       # serves the app on http://localhost:3000
```

The SQLite database is created automatically at `data/erika.db` on first run
(the `data/` directory is gitignored). Point `ERIKA_DB_PATH` at another file to
override it. Its tables and their relationships are documented in
[docs/schema.md](docs/schema.md), which every migration PR updates.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `http://localhost:3000`. |
| `npm run build` | Production build (fails on any type or bundler error). |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Vitest unit + integration tests. |
| `npm run worker` | Drains the ingest and analysis queues. **Nothing is processed until this runs.** |
| `npm run test:e2e` | Playwright end-to-end tests (boots a dev server on a throwaway DB). |
| `npm run screenshot -- <route>` | Headless PNG of a route into `artifacts/` (gitignored). |

`npm run test:e2e` and `npm run screenshot` need the Chromium browser once:
`npx playwright install chromium`.

### The worker

Uploading a recording or pressing Analyze only *queues* a job. A second process
does the work, so run it alongside `npm run dev`:

```sh
npm run worker
```

It is a plain Node process, not Next, so it loads `.env.local` itself
(`lib/env-file.ts` — an explicit loader rather than `node --env-file`, which
hard-fails when the file is absent). Variables already in the environment win, so
`OPENAI_API_KEY=… npm run worker` overrides the file. Without an
`OPENAI_API_KEY` the worker says so and exits non-zero at startup rather than
failing later at the first model call. While no worker is running, a job that has
sat queued says so on the session page instead of showing a calm badge forever.

### Screenshot a route

```sh
npm run screenshot -- /            # → artifacts/root.png
npm run screenshot -- /settings    # → artifacts/settings.png
```

The script boots its own dev server unless `SCREENSHOT_BASE_URL` points at a
running one.

## CI

`.github/workflows/ci.yml` runs `lint`, `typecheck`, `test`, `build`, and the
tripwire scan on every pull request to `master`.
