# Erika

Master the language you already speak. Local-first web app: give it your real speech — a mic take or a day-long dump from an always-on recorder; Erika extracts the moments you're talking, a native-audio model inventories your mistakes, and they become flashcards, micro-lessons, and a focus map. The curriculum is you.

- **PRODUCT.md** — what this is and why.
- **DESIGN.md** — the binding design constitution.
- **FEATURES.md** — milestones and what's next.
- **DECISIONS.md** — settled calls.

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
override it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on `http://localhost:3000`. |
| `npm run build` | Production build (fails on any type or bundler error). |
| `npm run start` | Serve the production build. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Vitest unit + integration tests. |
| `npm run test:e2e` | Playwright end-to-end tests (boots a dev server on a throwaway DB). |
| `npm run screenshot -- <route>` | Headless PNG of a route into `artifacts/` (gitignored). |

`npm run test:e2e` and `npm run screenshot` need the Chromium browser once:
`npx playwright install chromium`.

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
