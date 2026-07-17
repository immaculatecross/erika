# Erika — instructions for agent sessions

Read `AGENTS.md` and follow it — it routes every session to its playbook. Never write product code without a work order.

Boot order: STATE.md → FEATURES.md → DECISIONS.md → the files your task names. DESIGN.md is binding for any UI change.

## Stack and layout

Next.js (App Router, TypeScript strict) + Tailwind + better-sqlite3. Database and audio files live in `data/` (gitignored). Secrets only via `.env.local` — never in code, never committed. Prerequisites: Node 20+, system `ffmpeg`/`ffprobe`.

## Commands (from milestone E-1 on)

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test`

## Rules

- DESIGN.md is binding: Apple system palette, spring motion, system font stack. No UI component frameworks; Motion (framer-motion) and Lucide icons are the sanctioned exceptions.
- Source files stay under 500 lines — the pre-commit hook enforces it.
- Conventional Commits on every first line — the commit-msg hook enforces it.
- Never commit `.env*` (except `.env.example`) or anything under `data/`.
- Hooks are armed via `git config core.hooksPath .mfactory/hooks`; re-arm after a fresh clone.

## Ritual

A PR that completes a milestone flips its FEATURES.md status and regenerates STATE.md (one screen) in the same PR.
