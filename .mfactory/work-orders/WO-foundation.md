# WO-foundation — E-1 Foundation: shell & design system

Target repo: github.com/immaculatecross/erika · Branch: `feat/foundation` · Diff cap: ~400 lines (excluding lockfile; if the honest diff exceeds this, report `split` with a proposed division — do not trim tests)

## Objective

`npm run dev` serves a running Erika shell: a persistent sidebar (Sessions · Practice · Settings) navigating three routes, each an Apple-grade empty state per DESIGN.md, with Motion-driven page transitions and list-stagger that degrade to fades under `prefers-reduced-motion`. Data persists through a SQLite layer with an idempotent migrations runner; Settings writes four preferences that survive a reload. The four gate commands (`lint`, `typecheck`, `test`, `build`) pass locally and run as CI checks on every PR, and a Playwright script screenshots any route to a file. This is the skeleton every later milestone (E-2…E-5) builds on — get the architecture and the design tokens right, because they are inherited, not revisited.

## Acceptance criteria

Each criterion must have at least one test that would fail if the behavior were wrong.

1. **Dev + build boot clean.** `npm run dev` serves the app on localhost; `npm run build` completes with zero errors (run it — typecheck alone misses bundler failures). Both documented in README setup.
2. **Shell & routes.** A persistent sidebar with exactly three items — Sessions, Practice, Settings — navigates to `/` (Sessions), `/practice`, `/settings`. Sessions and Practice render DESIGN.md-compliant empty states: one quiet sentence + one action, no illustration. The active nav item is visibly marked. (Test: route renders + sidebar present on each.)
3. **Motion, and reduced-motion.** Route changes crossfade with a ~12px rise; list content staggers in (per DESIGN.md motion section, Motion/framer-motion, springs stiffness≈260 damping≈28). Under `prefers-reduced-motion: reduce`, all motion degrades to opacity-only fades — no transform-based movement. (Test: assert the reduced-motion branch is taken, e.g. Playwright with `reducedMotion: 'reduce'` or a unit test of the motion-variant selector.)
4. **SQLite + migrations runner.** A single DB module opens better-sqlite3 at `data/erika.db` (creating `data/` if absent). An ordered migrations runner applies pending migrations, records applied versions in a migrations table, and is idempotent — running it twice applies nothing the second time. (Test: run migrations twice against a temp DB; assert schema present and second run is a no-op.)
5. **Settings persist across reloads.** The Settings page reads and writes four preferences — target language, native language, model tier, monthly budget (USD) — through API route handlers backed by the DB. Values set, then re-fetched on a fresh DB connection (simulating reload), come back unchanged; invalid budget input is rejected with a truthful message, not silently coerced. (Test: API write→read integration test + a Playwright set→reload→assert.)
6. **Gates green locally and in CI.** `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` each exit 0 locally. A GitHub Actions workflow runs all four **plus** the tripwire scan (`.mfactory/hooks/run-tripwires.sh --all`) on `pull_request` to `master`, and every job passes on this PR. (Observable: green checks on the PR.)
7. **Screenshot script.** `npm run screenshot -- <route>` (or a documented equivalent) launches the built/dev app headless via Playwright and writes a non-empty PNG of that route to a file under a gitignored artifacts dir. Document the exact invocation in the README. (Test/smoke: script produces a file > 0 bytes for `/`.)

## Files and constraints

- **Stack (pinned — do not substitute):** Next.js App Router, TypeScript **strict**, Tailwind, better-sqlite3. **Vitest** for unit/integration tests (`npm run test`). **Playwright** for e2e + the screenshot script. ESLint for `lint`. `tsc --noEmit` for `typecheck`. Motion (framer-motion) and Lucide are the only sanctioned UI deps (DESIGN.md); **no UI component framework**.
- **DESIGN.md is binding.** Implement the palette as design tokens (CSS variables and/or Tailwind theme) for **both light and dark** via `prefers-color-scheme`. Per **D-14**: accent is black (light) / white (dark); green and red are the only color tones and only where a state carries meaning; **no indigo, no third accent hue**. System font stack, tabular numerals for stats, radii/shadows/glass as specified. A manual theme toggle is **out of scope** — follow the OS setting.
- **Persistence layer (pinned shape, reused by E-2…E-5):** one `lib/db` module returning a singleton connection at `data/erika.db`; migrations as ordered SQL (or TS) files applied by the runner and tracked in a `_migrations` table. Settings live in a `settings` table read/written via `app/api/settings` route handlers (API-first so a later mobile client can reuse it — D-2). Keep the DB out of React render paths (server-only).
- **Repo rules:** every source file **< 500 lines** (pre-commit enforces). Conventional Commits (commit-msg enforces). Never commit anything under `data/` or any `.env*` except `.env.example`. Hooks are already armed via `core.hooksPath .mfactory/hooks`.
- **Key files (indicative):** `package.json` scripts (dev/build/start/lint/typecheck/test/screenshot); `.github/workflows/ci.yml`; `app/layout.tsx` + sidebar; `app/page.tsx`, `app/practice/page.tsx`, `app/settings/page.tsx`; `app/api/settings/route.ts`; `lib/db.ts` + `lib/migrations/…`; `app/globals.css` / `tailwind.config` design tokens; `scripts/screenshot.ts`; motion helpers.

## Out of scope (do not touch)

- Any audio capture, recording, upload, or file ingestion (E-2). Sessions is an **empty state only**.
- Any model/API calls, cost logic, or analysis (E-4). "Model tier" and "monthly budget" in Settings are **persisted preference fields only** — no behavior hangs off them yet.
- Flashcards, SM-2, practice interactions (E-5). Practice is an **empty state only**.
- Auth, hosting, multi-user, mobile (E-14/E-15).
- A manual light/dark toggle; any third accent color; any component library.

## Milestone ritual (do in this same PR)

Per CLAUDE.md: flip **FEATURES.md** E-1 status `next → done`, set E-2 `backlog → next`, and **regenerate STATE.md** (keep it one screen) to reflect that the foundation shipped and E-2 is next. These ride inside this PR. Keep them truthful — the reviewer checks.

## PR description must state

What changed (one line per meaningful area), the **exact commands** run to verify each acceptance criterion and what they proved, and any risks. Title in Conventional Commit form (e.g. `feat: foundation shell, design tokens, sqlite + CI`).

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/4  (branch feat/foundation → master)
Changed:
  - Scaffold: Next.js App Router (TS strict) + Tailwind + Vitest + Playwright + ESLint; better-sqlite3 external to the server bundle.
  - Design tokens (app/globals.css, tailwind.config.ts): Apple palette light+dark via prefers-color-scheme; ink accent (black/white) per D-14, green/red semantic only; system font, tabular numerals, radii/shadows. No manual theme toggle.
  - Shell & routes: persistent sidebar (Sessions/Practice/Settings) with marked active item; / and /practice are empty states (one sentence + one action, no illustration); /settings is a form.
  - Motion (lib/motion.ts, app/template.tsx): route crossfade + 12px rise and list-stagger via springs (stiffness 260, damping 28); lib/use-reduced-motion.ts reads matchMedia so reduced motion degrades to opacity-only (Framer's own hook defaults to "never").
  - Persistence (lib/db.ts, lib/migrations/): singleton at data/erika.db (dir auto-created) + ordered idempotent migrations runner tracked in _migrations.
  - Settings API (app/api/settings/route.ts, lib/settings.ts): GET/PUT four preferences; invalid budget rejected with a truthful message; DB server-only (D-2).
  - CI (.github/workflows/ci.yml): lint + typecheck + test + build + tripwire scan on PRs to master.
  - Screenshot (scripts/screenshot.ts): npm run screenshot -- <route> writes a PNG to gitignored artifacts/.
  - Ritual: FEATURES.md E-1 next→done, E-2 backlog→next; STATE.md regenerated; README setup/commands documented.
Verified:
  - npm run lint → 0 errors. npm run typecheck (tsc --noEmit) → 0 errors (also passes with next-env.d.ts absent, matching a fresh CI checkout).
  - npm run test (Vitest) → 11 passed: migrations idempotent (2nd run applies nothing), settings persist across a fresh connection, invalid budget rejected, reduced-motion variant selector.
  - npm run build → clean; / /practice /settings static, /api/settings dynamic.
  - npm run test:e2e (Playwright, real dev server on throwaway DB) → 8 passed: routes render with sidebar + exactly 3 nav items, active item marked, empty-state action present with no illustration, Settings set→reload→survive, invalid budget shows a truthful message, reduced-motion emulation takes the opacity-only branch.
  - npm run screenshot -- / and -- /settings → non-empty 1280x812 PNGs in artifacts/.
Risks:
  - npm audit: 2 moderate advisories, all dev-only (esbuild/vite dev server); nothing ships to production. Next bumped to 15.5.20 (patched CVE-2025-66478); Vitest pinned to 3.x (4.x needs Node >=20.19; dev machine is 20.9).
  - e2e/screenshot need `npx playwright install chromium` once (documented). CI gates on the four commands + tripwires, not e2e, for speed/determinism.
  - Dispatcher follow-up: add the `gates` CI check context to master branch protection once this CI run registers (noted in STATE.md).
Blocker:  none
```

