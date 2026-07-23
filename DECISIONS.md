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

## D-16 · 2026-07-18 · v0.3 = E-16…E-23, ratified from RETRO-001 ("the coach closes the loop")

The first post-version retro ran after v0.2 (mfactory D-11 / `playbooks/retro.md`; filed as `RETRO-001`): three fresh independent lenses — **product** (seeded a populated account, drove every surface light+dark, 32 screenshots), **creative** (seeded a deliberate drilled-then-recurring fossil the product failed to notice), **technical** (read every load-bearing module, re-verified both run reports' debt, ran a live DB probe) — produced **20 ranked proposals** under the consequential-and-grounded bar. The operator ratified the dispatcher's adjudication: **16 approved, 2 deferred to v0.4 (Targets, pagination), 1 rejected** ("since you last checked" — killed by the creative lens itself under the "so what if we don't?" test, recorded rather than lost).

**v0.3 = E-16…E-23 in ID order, integrity first:** E-16 hardening (three probe-confirmed defects invisible to per-PR review because they live *between* milestones — cache-reuse cloning donor timestamps, reclaim-without-lease double-billing, unbounded segment length breaking day-scale analysis), E-17 one findings truth, E-18 the honest home, E-19 profile-primed analysis, E-20 slips, E-21 contrastive playback, E-22 the session map, E-23 Ask Erika. Ordered so **any prefix is a coherent release**.

**Why these:** the retro's two structural verdicts. (1) *"v0.2 is a beautiful filing system for your mistakes"* — the founding sentence's fourth clause, **"stop making them,"** has no representation anywhere; nothing can say a mistake was fixed, and DESIGN's green has nothing legitimate to attach to (→ E-20, and E-18 reclaims green). (2) **The analysis prompts are amnesiac** — `nativeLanguage` is collected in Settings and reaches no prompt; the user's error history and mastery never reach the model doing the listening, so "it studies you" is true only of the display layer (→ E-19). **Consequences:** ~18 minor-polish items from the three appendices ride as fold-ins inside whichever milestone touches their surface (enumerated in RETRO-001), not as separate work; the retro's own demonstrated-failure lesson — a raw-NUL/binary source file passing every automated gate while bypassing diff review — becomes a tripwire rule in both the mfactory canonical hooks and Erika's pinned kit.

## D-17 · 2026-07-23 · The Learn era: two tabs, a knowledge model, mobile-first trajectory (v0.4–v1.0 = E-24…E-41)

The operator delivered the next-era vision; four research spikes grounded it (`docs/research/spike-1…4`); this entry ratifies the synthesis. Erika becomes a **two-tab product**: **Record** — the existing capture→analysis spine at the richest extraction we can buy — and **Learn** — a daily course (grammar, vocabulary, pronunciation, reading/listening micro-lessons, plus a live tutor conversation) composed **from the user's own recorded mistakes first**, canonical material only when that well runs dry. The era's spine is the knowledge model (D-19). Italian-only until excellent; the app speaks English. Platform trajectory: web in a phone viewport until feature-complete → hosted (v0.9) → native iOS as a frontend over the same API (v1.0); Android after. Existing surfaces demote to secondary (Library under Record; focus and the letter under Learn) — nothing is deleted. **Why:** the record→learn feed is the product's unique asset; generic lessons exist everywhere. **Consequences:** the FEATURES.md version ladder; merging the roadmap PR ratifies it; the D-13 bare mission now points at v0.4 = E-24…E-29. A trial plan review (two fresh lenses over this plan before ratification — the mfactory `ideate.md` mechanism born from this wave) amended the ladder: the tutor closes v0.5 (the operator ranked it "the most important one"), parallel cascade moved into v0.4 (the constant-wall-clock requirement is met before the richness dial opens spend), placement moved to v0.6, positive production evidence landed in E-28, and the streak's day ledger starts with the composer (E-31).

## D-18 · 2026-07-23 · Correction-forward, error-once (amends E-5 card fronts and E-9 presentation)

The user's errors are **never practice stimuli**: card fronts and exercise prompts are meaning-first (English gloss or Italian context gap) and the retrieval target is always the correct form. The original utterance appears exactly **once**, at feedback time — correction headlined, the error subordinate and unmistakably marked — then retires. Contrastive playback and the slips dossier stand (deliberate noticing and analytics, not drills). **Why:** SLA's noticing hypothesis and the hypercorrection effect argue for one clear confrontation; lure-familiarity research argues against ever rehearsing the wrong form. The operator's instinct ("mistakes sink in") settled the drilling half; the evidence settled the noticing half. **Consequences:** E-28 retrofits cards, phrasebook, and the report; an optional strict-hide toggle is deferred until someone asks.

## D-19 · 2026-07-23 · The knowledge model: append-only production evidence, FSRS-6 strength

An append-only `evidence` log (sources: findings, exercises, tutor turns, placement) with mode weights — spontaneous 1.0 ≫ cued 0.6 ≫ recognition 0.3, ×0.7 discount when audio-derived — from which per-item knowledge state (lemma+POS with lazy sense splits, grammar rule, phone) is **derived and rebuildable**, never stored as source truth. Scheduling: **FSRS-6 via `ts-fsrs` (MIT)** replaces SM-2 everywhere; retrievability R(t,S) is the one strength scalar for every item kind; existing cards are state-seeded (S≈interval, ease→difficulty), reviews logged as evidence, parameters optimized later. "Known" requires corroboration: ≥2 correct events on ≥2 days, ≥1 spontaneous, never audio-only, none incorrect since. **Production evidence only** — no ambient-exposure mining of other speakers (operator call, 2026-07-23; upholds D-2's privacy stance). Production evidence includes what the user gets **right**: the deep pass also emits correctly-produced lemma+POS (morph-it-validated), written as discounted spontaneous-correct evidence — Record teaches the model the user's real vocabulary, not only their errors, and recording-attested lemmas are excluded from new-item selection. Lexicon: ~15k lemmas from license-clean sources (FrequencyWords CC BY-SA through a morph-it lookup table in SQLite); CC BY-NC resources (Kelly, itWaC, spaCy models) stay reference-only, out of the shipped data path. Grammar: an LLM-authored ~180–250-rule prerequisite DAG structured after the *Profilo della lingua italiana*, operator-checked in review. **Why:** evidence types differ in strength, audio evidence is noisy, and a derived state survives model improvements; FSRS tolerates the irregular timing production evidence has and SM-2 does not.

## D-20 · 2026-07-23 · Spend for signal: the richness dial (amends D-10's posture, keeps its architecture)

The operator's call: spend more for the richest picture of the user's behavior. Captures **≤30 min skip triage** — 100% deep-listen at native speed with an enriched prompt (pronunciation suspects, colto register upgrades, disfluencies) ≈ $0.22 per 10-min capture. Day dumps keep VAD + cascade with triage loosened toward ~50% flagged ≈ $1.77 per 12-h dump (Batch API on the deep leg optional, −50%). D-3 stands: never STT for error detection. `rates.ts` is recalibrated — the deep model truly costs ~$0.02/audio-min audio-in, **~$0.03/audio-min all-in with text output, roughly half the currently ledgered $0.06** (the all-in figure is the recalibration target) — and the default cap rises to match the posture. Enriched observations persist (new finding categories or a structured notes channel — the work order decides) and deep max-tokens rises so truncation repairs stay rare. Ledger, estimates, caching, and lease-before-spend are unchanged.

## D-21 · 2026-07-23 · Pronunciation: the LLM flags, Azure scores, clean audio only (extends D-3)

Phone-level judgments from audio LLMs are unreliable — they diagnose from L1 stereotypes over acoustics (evidence in `docs/research/spike-3`). So the deep pass only **flags suspects** (gemination, vowel aperture, stress), and scoring happens on scripted re-record drills via **Azure Pronunciation Assessment** (it-IT, phoneme-level scores, ~$1/audio-hour). Scripted assessment of a known drill text is not D-3's banned STT — nothing free-spoken is transcribed for error detection. Ambient day-dump audio is never pronunciation-scored. **Consequences:** a second provider secret (`AZURE_SPEECH_*`) enters `.env.local` at E-37; Azure spend enters the same `spend_ledger` under the same cap.

## D-22 · 2026-07-23 · Speaker filtering is local and recall-first (fulfils E-13's founding promise)

Speaker verification runs **on-device** (sherpa-onnx embeddings; ~45 s enrollment take; centroid match, max over 3–5 s windows). Recall-first: drop only confident-non-user; uncertain flows through to analysis; the threshold is calibrated against a committed two-real-voice labelled fixture (D-13 pattern, user recall ≥0.99). Excluded audio is flagged and counted visibly, never deleted. Fallback: session-level clustering of the same embeddings; still unsure fails open to analyze-everything. A kill-switch env disables the filter. **Hosted speaker-ID is never the default** — bystander audio never leaves the device.

## D-23 · 2026-07-23 · Register: italiano colto, as a dial

A Settings dial — colloquiale → standard → colto → letterario — **default colto**, injected into analysis recasts, lesson generation, the tutor persona, and TTS instructions. Reading/listening draws on the public-domain canon (Manzoni, Dante, Pirandello, Verga). The product is usable by natives polishing their register. "Dante-level" is the ambition, not the grammar: elevated contemporary Italian, no archaisms.

## D-24 · 2026-07-23 · The habit layer is calm (scopes E-12's "no gamification")

Learn gets exactly: a **streak** counting any completed daily goal, with two automatic silent repairs per month ("Day 14 · repaired Tue"); one **ink goal ring**; one **factual completion moment** per day; a **knowledge map** whose cells tint toward green only through resolved-slip semantics — green stays mastery, never activity. Banned: confetti, mascots, XP/points/levels, leaderboards, badges, purchasable anything, loss-guilt copy, more than one celebratory beat per day. DESIGN.md's Copy rule is amended in the same PR: factual acknowledgment is not cheerleading. The editor's letter stays outside the mechanics. Streak days are **local days**, stated explicitly (the E-22 UTC lesson).

## D-25 · 2026-07-23 · The API boundary is codified; uploads are tus (extends D-2)

The audit found the boundary already clean — every page fetches JSON from `/api/*`; no server component touches SQLite; no filesystem paths leave the server. Codified for all new work: every capability ships as a JSON `/api` route first; one error envelope `{ error: { code, message } }`; a no-op auth middleware stamps the single-user principal today; additive changes only, a version prefix only when native ships. One retrofit: `GET /api/letter`'s viewed side effect becomes a POST (E-18's recorded limitation). Uploads move to **tus** (`@tus/server` catch-all route + `tus-js-client`; the streamed POST stays as fallback; TUSKit serves the native client later); partial uploads get an expiry policy. Hosting direction when the laptop era ends: single node + Litestream (E-40); Postgres is not warranted.
