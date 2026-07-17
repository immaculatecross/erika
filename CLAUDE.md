# Erika — instructions for agent sessions

Boot order: STATE.md → FEATURES.md → DECISIONS.md → the files your task names. DESIGN.md is binding for any UI change.

## Stack and layout

Next.js (App Router, TypeScript strict) + Tailwind + better-sqlite3. Database and audio files live in `data/` (gitignored). Secrets only via `.env.local` — never in code, never committed. Prerequisites: Node 20+, system `ffmpeg`/`ffprobe`.

## Commands (from milestone E-1 on)

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test`

## Rules

- Monochrome only; no UI component libraries; system font stack (DESIGN.md).
- Source files stay under 500 lines — the pre-commit hook enforces it.
- Conventional Commits on every first line — the commit-msg hook enforces it.
- Never commit `.env*` (except `.env.example`) or anything under `data/`.
- Hooks are armed via `git config core.hooksPath .mfactory/hooks`; re-arm after a fresh clone.

## Ritual

A PR that completes a milestone flips its FEATURES.md status and regenerates STATE.md (one screen) in the same PR.
