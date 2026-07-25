# WO-E43 — The tutor, rebuilt: one voice

Target repo: github.com/immaculatecross/erika · Branch: `feat/e43-tutor-voice-loop` · **Review tier: Full**
Batch: **pipelined behind WO-E42.** You share no file with it (E-42 owns the Record tab, ingest and the analysis enqueue; you own `lib/tutor/**`, `app/practice/tutor/**`, `components/tutor/**`). **E-42 owns migration v28; you own v29** and must assume v28 exists — branch from the current `master` you are given and let the dispatcher handle merge order. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual — do not touch those two files.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-43), `DECISIONS.md` (**D-26** is why this exists; also **D-3**, **D-19**, **D-21**, **D-23**, **D-24**), `HANDOVER.md`, `CLAUDE.md`, `DESIGN.md`, and — **required, it is the empirical ground for every model, rate and latency choice below** — `docs/research/spike-5-voice-loop.md`, which was measured against the live API for this milestone. Then `.mfactory/playbooks/task.md`, which you execute.

## Objective

The tutor works and is well-engineered, and the operator's verdict after real use is still: *"the realtime API does not really work while producing good sounding Italian. It listens very well, but it does not speak super well."* Listening was never the problem; the voice was. So the transport changes and nothing else about the ambition does.

Replace the Realtime/WebRTC tutor with a **turn-based STT → LLM → TTS loop** behind a vendor seam, so the voice is chosen and steerable and a different vendor (Cartesia is the operator's named candidate) can be dropped in without touching the conversation logic. This is also, and not incidentally, the deletion of about a thousand lines of ephemeral-secret minting, SDP exchange and long-lived spend-lease machinery — machinery that has produced **three** production defects in one version: a fabricated request field that 400'd OpenAI and broke the tutor in real use while CI stayed green, a ~2.5× double-charge race, and a legal 21-minute call that bills **1.9×** because `RESERVATION_STALE_MS` (15 min) is shorter than `maxTutorSessionMinutes()` (30 min) and the sweep runs at the top of every analysis job. **Deleting the lease is how that last one gets fixed** — do not port it.

D-3 is not in tension with this and you must not read it as such: D-3 forbids speech-to-text as the mechanism for **error detection over the learner's real recorded speech**, and that path is untouched — the conversation is still recorded and still lands as a normal session for native-audio deep analysis. STT here is transport for a live conversation, exactly as D-21 already permits for scripted assessment.

## Acceptance criteria

1. **The loop works, end to end, in Italian.** A learner speaks; their turn is transcribed; a reply is generated in the D-23 register with the E-19 profile, the active slips and today's composer targets in its instructions; the reply is spoken back in good Italian; the exchange continues without the learner pressing anything between turns. Turn-taking ends a turn on **silence detection**, not a push-to-talk button — no buttons is the whole point of this version.
2. **A vendor seam, matching the house pattern.** Two interfaces — `SpeechToText` and `TextToSpeech` — injected exactly the way `AudioModelClient` (`lib/analysis/audio-model.ts`) and `SpeakerEmbedder` (`lib/speaker/`) already are: a real implementation, a deterministic in-sandbox fake for tests, and the choice made by the caller, never by a module-level singleton. The boundary is the **parsed** result, not a vendor response object. Prove the seam by writing a second, trivial implementation in tests and swapping it with no change to the loop.
3. **The persona and its guardrails survive verbatim in force.** `lib/tutor/persona.ts` and the shared definition of what counts as a mistake (`lib/mistakes.ts`, landed by PR #66) compose the instructions. Every precision guardrail still binds: never invent an error; if you did not clearly hear it, do not flag it; never flag an acceptable regional variant; never infer the learner's gender from their voice; never infer an error from the L1; **at most one correction per learner turn**; no re-drilling; the D-23 register line composes first. A test asserts each is present in the instructions the LLM actually receives.
4. **`log_evidence` survives as a tool call on the text model.** Same contract as today (`lib/tutor/log-evidence.ts`): append-only evidence, on morph-it-validated lemma ids and seeded rule ids only, invalid ids **rejected and never minted** (D-19). Recognition/cued modes still never mint `known`.
5. **The conversation still becomes a session.** It is recorded client-side and lands as a normal session → ingest → analysis, so findings come from one channel (E-17) — and with E-42 merged, that analysis now starts by itself.
6. **A minimum duration, settable and visible.** A new setting (default **5 minutes**; `settings` is a key/value table, so this needs no schema change) with calm progress toward it on the tutor surface — D-24's geometry-and-numbers rule binds: tabular numerals, no character, no gamified meter. Reaching it is recorded durably on the conversation (criterion 7). Below the minimum the conversation is still real and still logs evidence; it simply has not met the bar. **No countdown, no warning, no guilt copy** if the learner leaves early (D-24).
7. **Migration v29 — `tutor_conversations`.** A durable per-conversation record: start, end, the server-measured duration, whether the minimum was met, and the session id of its recording when one exists. This is the **contract WO-E44 consumes** to credit the day, so get its shape right and document it in `docs/schema.md` in the same PR (`tests/migrations.test.ts` enforces the pairing). Duration is **server-measured** — a client-reported number may only ever *lower* it, never raise it. v29 is the next free number after E-42's v28; never renumber a migration.
8. **Money: per-leg, reserve-before-call, no lease.** Each billable leg (STT audio seconds, LLM tokens, TTS characters) reserves before it fires and finalizes on resolve, on the one `spend_ledger`, under the one hard cap, cross-biller (E-27). No long-lived reservation, therefore no stale-lease window and no sweep interaction — state in the PR body, with the code to back it, why the 1.9× overbill is now structurally impossible rather than merely fixed. A cap refusal must refuse *before* a call and mint no charge; a crash with audio already on the wire must still record the spend.
9. **Rates at or above reality, with the dangerous direction named.** Take every unit price from `docs/research/spike-5-voice-loop.md`, cross-check `lib/analysis/rates.ts`, and **fix any rate that sits below reality** — including the known one: **TTS is billed per input *character* at the audio-*output-token* rate**, ~1.3–1.6× under-priced, and that same figure is the reservation and cap check. `docs/research/spike-3` ordered this fix and only half of it landed. Rates are pinned as **floors**, and the definition site says which direction is dangerous: over-estimating costs a slightly early refusal, under-estimating makes the cap a lie. This repo has been bitten three times by exactly this; a review that flags one instance is not a sweep.
10. **The old transport is gone, not disabled.** `gpt-realtime-*` leaves the runtime path along with the ephemeral mint, the SDP/WebRTC client, the lease/heartbeat machinery and their routes. The `realtimeTier` Settings knob goes with them — one fewer thing to choose, per D-26; the model choice becomes a code default with an env override if you need one. Deleting a Settings key must not break `readSettings` for a database that stored it.

## What this milestone deletes

D-26 makes subtraction the deliverable; your PR body carries a **"What this deletes"** section. Expected: `lib/tutor/mint.ts`, `lib/tutor/realtime-client.ts`, the lease half of `lib/tutor/money.ts`, the realtime-specific parts of `lib/tutor/session-config.ts`, the heartbeat and end routes, the `realtimeTier` knob, and the whole ephemeral-secret concept. Roughly a thousand lines should leave. If the diff is net-positive in concepts, justify it explicitly.

## Files and constraints

Centre of gravity: `lib/tutor/**` (rewritten), `lib/speech/` or similar for the new seam, `app/api/tutor/**`, `app/practice/tutor/page.tsx`, `components/tutor/**`, `lib/settings.ts`, `lib/analysis/rates.ts`, `lib/migrations/v29-tutor-conversations.ts` + `lib/migrations/index.ts`, `docs/schema.md`.

Must not break: append-only `evidence` and its v14 triggers; D-19's `known` corroboration; `lib/findings-model.ts` as the one findings gate (E-17); reserve-before-call, the hard cap, and spend recorded when a call resolves; D-18 correction-forward; **D-24's ban list** — no confetti, mascots, XP, points, levels, leaderboards, badges, or more than one celebratory beat per day, and the tutor surface stays *"a quiet field of small accent-colored dots breathing with the tutor's voice — no avatar, no face, no waveform theatrics"* (DESIGN.md). The key must never reach the browser; a test proves it, as one does today.

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file, never edit a shipped migration, never commit `data/` or `.env*`, **disposable database only** (`ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, never `data/erika.db`).

## Live API use — you may spend, within a hard ceiling

`.env.local` holds a working `OPENAI_API_KEY`. **You may spend up to $1.50 of real money** verifying the loop against the live API, and you should: no path in this app has ever run against a live API, and the mint-body bug proved a mock cannot catch contract drift. Report the actual total in your exit report. Never print, log or commit the key. If OpenAI is degraded (it was returning HTTP 500 on every endpoint on 2026-07-25 morning), retry with backoff and, if it stays down, say so plainly and deliver the mocked path with the live verification explicitly marked **not performed** — never fabricate a measurement.

Leave behind at least one **key-gated smoke test** per integration (STT, LLM, TTS): the cheapest possible real call, asserting the response *parses*, skipped when no key is present. This is OBS-001, owed since v0.5.

## Out of scope

The daily session shell and what completes a day (WO-E44 — you supply the `tutor_conversations` contract and stop there); lesson or card content (WO-E45); onboarding and the progress surface (WO-E46 — it will reuse your STT for a spoken level check, so keep the seam clean and importable); the Record tab (WO-E42); Azure pronunciation assessment (D-21, untouched); `FEATURES.md`/`STATE.md`.

## Verification (this repo's five hard-won rules apply)

1. **Drive the built app** on a fresh disposable database, with a key and without. A milestone with a UI that has not been walked in a browser has not been verified — E-37 shipped with every route into its page dead, past 958 green tests and three Full reviews.
2. **Prove which server answered you** — bind an unusual port, assert a string unique to your build, and state the proof in the exit report.
3. **Mutation proof on every new guard**: break it, show red, restore, quote the output. Expectations come from the fixture, never from the artifact under test.
4. **Fix invariants, not instances**: state the money invariant and enumerate every path that could violate it before writing criterion 8, then ask what the opposite failure looks like (an over-refusal, a charge recorded twice, a charge lost).
5. **Check the repo's own research before writing a constant** — `docs/research/spike-3` and `spike-5` both bind here, and code has drifted from them before.

Gates: `lint` · `typecheck` · `test` · `build` green, plus tripwires. **Branch and push first**: an empty commit and `git push -u origin feat/e43-tutor-voice-loop` as your very first action.

## Exit report

Append here and **write it before returning**. Include: criterion-by-criterion status; the "What this deletes" list with line counts; the live-API results (or an honest statement that the API was unavailable) and the exact dollars spent; the rate cross-check against `spike-5` and `rates.ts` with every correction made; the mutation proofs; the proof of which server answered; and the exact shape of the `tutor_conversations` contract WO-E44 will consume.

---

## Amendment 1 — 2026-07-25, from the live voice spike (`docs/research/spike-5-voice-loop.md`)

The spike ran against the live API after the outage cleared at 09:44:44 UTC and spent $0.003. Everything here is **measured**, not documented. Three of its findings change this work order.

11. **Streaming TTS is mandatory, not an optimization.** A blocking turn measured **p50 4.63 s** (STT 1.03 / LLM 1.04 / TTS 2.42) — worse than the acceptable band, and worse than the Realtime tutor it replaces. Streaming SSE measured **TTFB 0.844 s → ≈2.9 s perceived**. Build the loop streaming-first; a blocking implementation fails this milestone even if every test passes. Say in the exit report what the learner actually experiences between finishing a sentence and hearing a reply, measured on the built app.
12. **The TTS rate is wrong in the unsafe direction, and this is the second independent finding of it.** `lib/analysis/rates.ts` bills `usdPerCharacter`, but `gpt-4o-mini-tts` bills per **audio-output token**; the per-character shape is correct only for `tts-1` and was carried over wrongly. Measured under-pricing: **1.23×–1.76×, voice-dependent** (speaking rate varies 1.42× across voices, so a per-character model cannot be right for a token-billed endpoint). `docs/research/spike-3` flagged this on 2026-07-23 and it was not acted on. Criterion 9 is therefore not satisfied by a small correction: change the **shape** of the price, not just its value, and pin it as a floor.
13. **Two live contract facts to build against, not around.** `verbose_json` on `gpt-4o-transcribe` is a hard **400**, not a graceful downgrade — timestamps are `whisper-1`-only, so if the loop needs word timings, that dictates the model. And `gpt-4o-mini-tts-2025-12-15` is a pinnable snapshot; prefer pinning over a floating alias for a path that bills.

**Cost, for the record:** a 10-minute conversation measures **≈$0.10–0.11**, against ~4.5× that for `gpt-realtime-2.1-mini` and ~14× for the flagship. TTS is ~76% of it. The migration is a large cost reduction as well as a quality one — say so honestly in the PR body rather than overclaiming either.

**STT is not the weak link:** 0.00% WER on all three models, on clean audio *and* on 8 kHz/16 kbps/1.15×-degraded audio. The spike flagged its own limit honestly and you must not overstate it: the test audio was TTS output, which is unnaturally clean, so **relative accuracy on real learner speech is not established**. Your live smoke tests should use a real human take if you can make one.

**The voice is the operator's call, not yours.** The spike deliberately declined to pick it — choosing a voice from a spec sheet is the exact mistake that caused this migration. Samples are in `artifacts/voice-samples/` and have gone to the operator. Build the voice as **configuration with a documented default**, so the answer can land without touching the loop.

---

## Amendment 2 — 2026-07-25, the operator's voice ruling (supersedes Amendment 1's open question)

The operator listened to the five samples and ruled: **`alloy` and `nova`** — *"the first and last are great, and allow in settings to choose male or female."*

Two things follow, and the second one is the more important.

14. **Ship both voices as a Settings choice.** One dial, two options, presented the way the operator asked — a male/female choice — defaulting to one of them (pick either; say which and why in one line). This is the **only** new Settings knob v0.7 adds, and it is affordable because D-26 deletes `realtimeTier` in the same milestone: the count goes down, not up. Do not offer the other voices; a spec sheet full of options is the thing this version exists to remove. Note honestly in the code comment that OpenAI does not label its voices by gender — the mapping is the operator's ear applied to these two specific renditions, which is a better authority than a datasheet, but it is not a vendor guarantee.

15. **Default to plain synthesis, not instructed — the steering channel is opt-in, not free quality.** Both voices the operator chose were the **plain** samples; all three *instructed* renditions were passed over. That is evidence against the assumption Amendment 1 inherited, which was that `instructions` improves Italian delivery. Measurably, instructing `alloy` made it speak **9% faster** — a change, not obviously an improvement. So: **do not send a style instruction by default.** D-23's register dial still governs *what the tutor says* (word choice, formality) through the LLM leg, which is where register has always belonged; it must not be silently re-implemented as TTS prosody styling. If you keep an `instructions` pathway at all, keep it empty by default, and state in the exit report what it does when set. **Do not tune it to taste** — the operator's ear is the oracle here and they have already answered.
