# Decisions

Append-only. Settled calls — don't re-litigate. Reversals get a new entry that names the old one.

---

## D-1 · 2026-07-17 · Name and concept: Erika — "it studies you"

The operator settled the name Erika. The concept: a correction layer over the user's real speech, for advanced speakers whose remaining errors are fossilized and personal. Erika derives the curriculum from the speaker's own recorded life, not from invented course content.

## D-2 · 2026-07-17 · Local-first web v1; no auth

Next.js (App Router, TypeScript strict) + Tailwind + better-sqlite3, running on the user's machine. No accounts in v1; OAuth and hosting are E-7. **Why:** zero infrastructure, privacy by construction (day-long recordings capture bystanders), and API routes that a later mobile client can reuse.

## D-3 · 2026-07-17 · Native audio analysis, never speech-to-text

Analysis calls `gpt-audio-1.5` (fallback `gpt-audio`) with audio input, chunked into ~10-minute mono MP3 segments to stay under request limits. **Why:** a transcript erases exactly the signal an advanced learner needs — pronunciation, hesitation, the almost-right word. Verified live at founding: a planted-error recording came back with every mistake identified, corrected, and explained.

## D-4 · 2026-07-17 · DESIGN.md is binding; no component library

Strict monochrome design constitution, hand-rolled components, system font stack. **Why:** many fresh worker sessions must produce one coherent, Apple-grade product; a written constitution is the only shared taste they can have. A library would fight the aesthetic and bloat the bundle.

## D-5 · 2026-07-17 · v0.1 spans E-1…E-4 (foundation → flashcards)

Four missions, overriding ideate's one-or-two-mission default. **Why:** the operator explicitly wants to exercise long-horizon dispatch ("test your ability in long horizon tasks"). The same-day-mergeable rule still applies to each individual mission.

## D-6 · 2026-07-17 · Private repo under immaculatecross; PRs + CI from mission one

github.com/immaculatecross/erika, private (author identity per mfactory D-08). Every mission is a real PR with CI checks (lint, typecheck, test, build, tripwires). Branch protection on private repos needs a paid plan — if GitHub refuses it, arming it is the operator's preflight item and the dispatcher merges only on an approving review verdict meanwhile.

## D-7 · 2026-07-17 · System ffmpeg/ffprobe is a prerequisite

Transcoding and duration probing shell out to the system ffmpeg (present on the dev machine, v7.1). No bundled binary. **Why:** a ~70 MB static dependency versus a one-line brew install; revisit at E-7 when the app leaves this machine.
