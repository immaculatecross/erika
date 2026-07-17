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

Transcoding and duration probing shell out to the system ffmpeg (present on the dev machine, v7.1). No bundled binary. **Why:** a ~70 MB static dependency versus a one-line brew install; revisit at E-14 when the app leaves this machine.

## D-8 · 2026-07-17 · Design is Apple-grade, not monochrome (amends D-4's constitution content)

The operator clarified: "monochrome" meant elegance, not the absence of color. DESIGN.md is rewritten around the Apple system palette (neutral canvas, one indigo accent, muted semantic colors), translucency and depth, and spring-based motion. Motion (framer-motion) and Lucide icons are now sanctioned dependencies — animation quality demands a real motion library. D-4's spine stands: DESIGN.md stays binding, and there is still no UI component framework.

## D-9 · 2026-07-17 · Day-scale capture: dumps up to 24 hours (amends D-3's 30-minute framing)

Capture accepts files up to 24 h / 2 GB, streamed to disk and processed as resumable async ingest jobs — never inside a blocking request. **Why:** the real source is an always-on recorder carried through a whole day; thirty minutes was caution, not design.

## D-10 · 2026-07-17 · Cost is an architecture problem: extract speech, then cascade

Nothing reaches a model until voice-activity detection has stripped silence and noise (a day dump typically collapses to 1–2 h of actual speech). Then a cascade: `gpt-audio-mini` triages time-compressed (1.25–1.5×) segments and flags suspicious windows; `gpt-audio-1.5` deep-listens only those windows at native speed, where pronunciation fidelity matters. Segments are content-hashed and cached — nothing is ever billed twice. Every run shows a cost estimate from an editable rates table before starting, and a monthly budget cap in Settings halts autonomous runs truthfully. **Why:** naive day-long analysis on the deep model would cost tens of dollars per day; VAD plus the cascade cuts billed model-time by an order of magnitude or more.

## D-11 · 2026-07-17 · Public repo; autonomy-first gate (amends D-6)

The repo is public at the operator's request. Branch protection armed on master: pull requests required, linear history, no force pushes or deletions, **zero required approvals** — so the single-identity factory merges autonomously on the reviewer session's approve verdict (the sanctioned fallback in mfactory D-08). Required status-check contexts are added the moment CI lands with E-1. The formal review gate is a future upgrade — a GitHub App as reviewer identity (mfactory M-4), one-time setup, still zero ongoing human approvals. No additional GitHub account is needed.

## D-12 · 2026-07-17 · Ambitious roadmap adopted; v0.1 = E-1…E-5

Smart ingest earned its own milestone (E-3), so the operator's "through flashcards" v0.1 is now five missions, and the backlog runs E-6…E-15 (lessons, focus map, pronunciation studio, recast phrasebook, conversation gym, speech archive, editor's letter, voice enrollment, hosting, companion/mobile). **Why:** the operator asked for a deeply ambitious roadmap and explicitly wants long-horizon dispatch exercised.
