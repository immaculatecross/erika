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

## D-13 · 2026-07-17 · The bare mission: "Build the product" runs unattended

"Build the product" (or any bare build request) is a complete mission: the FEATURES.md milestones inside the current version scope (today: v0.1 = E-1…E-5), in order, one work order at a time through the full loop, merging on the reviewer session's verdict (D-11). **Why:** the operator wants true fire-and-forget with a simple message; scope already lives in FEATURES.md, so the message only needs to point at it. **Consequences:** the dispatcher interrupts the operator only for a second review rejection on the same PR, a blocker unanswerable from the artifacts, or a preflight box it cannot verify itself — everything else lands asynchronously as PRs, run reports, and the final report.

## D-14 · 2026-07-17 · Accent is black and white, not indigo (amends D-8's palette)

The operator dropped the indigo accent (`#5856D6`/`#5E5CE6`): the accent is now **black in light mode, white in dark** — for interactive elements, focus rings, and the one number that matters on a screen. The only color tones are **green and red**, used solely where a state carries meaning. D-8's semantic severity scale stands (red high, orange medium, green resolved/mastered) — those hues are meaning, not decoration — as does the rest of D-8 (Apple system canvas, translucency and depth, spring motion, Motion + Lucide sanctioned). **Why:** the operator wants a stricter, more timeless monochrome-plus-signal palette; a colored brand accent reads as decoration at this level of restraint. **Consequences:** no worker introduces an indigo (or any third-hue) accent; primary buttons fill with ink and use inverse-color text.

## D-15 · 2026-07-18 · v0.2 scope adopted; unattended build extended v0.1 → v0.2 (extends D-12/D-13)

The operator extended the standing mission mid-run (going offline): build through v0.1 **and on into v0.2**, unattended, "as much as possible," delegating the v0.2 scope to the dispatcher. **v0.2 = the coaching layer over v0.1's findings — E-7 (focus map & progress metrics), E-9 (phrasebook / recast library), E-11 (speech archive), E-6 (micro-lessons), E-12 (editor's letter)** — dispatched in that **priority order**: value and low-risk front-loaded (E-7/E-9/E-11 are largely data/UI over existing findings), model-spend (E-6) and the trend-dependent capstone (E-12) last, so any partial completion is still a coherent release. **Deferred to v0.3:** E-8 (pronunciation studio), E-10 (conversation gym / realtime), E-13 (voice enrollment / diarization), E-14 (hosted + OAuth), E-15 (companion + mobile) — each needs new heavy infrastructure (realtime audio, auth, mobile, speaker models), the wrong risk profile for an unattended run; **E-8 is the top v0.3 stretch item**. **Why:** the operator wants maximum autonomous progress overnight and asked the dispatcher to choose a coherent, buildable scope. **Consequences:** the bare "build the product" standing order (D-13) now spans E-1…E-5 then E-7,E-9,E-11,E-6,E-12; the same loop, gate, and demonstrated-harm review bar apply to every milestone (no bar-lowering for speed); the D-13 stop conditions are unchanged (second same-PR rejection, an unanswerable blocker, or a spend-limit/infrastructure halt → pause and surface). Each version files its own run report (v0.1 = RUN-001; v0.2 = RUN-002, opened when E-5 merges).
