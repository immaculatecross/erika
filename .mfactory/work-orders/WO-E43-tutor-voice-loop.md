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

---

## Standing clause — product authority (operator directive, 2026-07-25)

Operator, on approving the v0.7 plan: *"aim for a really complete, usable, intuitive consumer product. Each one of those can have solutions — really make product calls, after thinking well and justifying them a little bit."*

**So the bar is not "the acceptance criteria are satisfied." The bar is that a person who has never seen this repository can use the thing end to end, without asking a question, and want to come back tomorrow.** If a criterion is ticked and that sentence is still false, the milestone is not done.

**You have product authority inside this milestone's scope, and you are expected to use it.** Choose the interaction. Choose the copy. Add the affordance the flow obviously needs and the work order failed to name. Resolve the ambiguities it left. Do not ship something technically correct but half-usable because the brief did not mention the missing half — a work order is the dispatcher's best guess at the product, written without having built it, and it is not scripture.

**The price of that authority is a short written justification.** In the PR body, a section that names each real product call: what you chose, what you rejected, and why. Two or three sentences each. If a call you want to make **contradicts an acceptance criterion**, that is allowed — say so explicitly, make the case, and implement your call; what is not allowed is silently narrowing the milestone, or leaving a criterion unmet without saying that you did.

**What is not yours to move**, because it is settled and re-litigating it wastes the run: the binding decisions — `DESIGN.md` in full, D-18 (correction-forward, error-once), D-19 (the knowledge model and the `known` gate), D-22 (speaker filtering local and recall-first), D-23 (register), D-24 (the calm habit layer and its ban list), E-17 (one findings truth), the money spine (reserve-before-call, the hard cap, spend recorded when a call resolves), and the rule that a shipped migration is never edited. Also not yours: **another milestone's scope.** A product call that belongs to a later milestone is a note in your exit report, not a diff — the dispatcher will route it.

**And subtraction still wins ties.** D-26 exists because this product acquired too many concepts, not too few. When two designs are close, ship the one with fewer things on screen.

---

## Amendment 3 — 2026-07-25 · **D-28 corrects this work order's architecture. Read D-28 before anything else.**

The operator: *"for listening in recording, and trying to understand mistakes, I think realtime might be good."* They are right, and the original objective above contained a real flaw.

**A pure STT → LLM → TTS loop would have made the tutor detect mistakes from a transcript** — exactly what **D-3** forbids, because *"a transcript erases exactly the signal an advanced learner needs — pronunciation, hesitation, the almost-right word."* The tutor's entire job is catching errors an advanced speaker still makes. It cannot be the one surface in this product that listens through text. Everything in the criteria above that assumes Whisper/`gpt-4o-transcribe` hears the learner's free speech is **superseded**.

16. **The listening leg is native audio.** The tutor hears the learner with an audio-native model, as the analysis path does. STT survives in this milestone only for a **scripted, known-answer drill response** (D-21's existing allowance) and for E-45's voice-answered exercises — never for free-spoken error detection.
17. **The speaking leg is TTS**, unchanged from Amendment 2: `alloy` and `nova`, plain synthesis, operator-chosen. This was always the only broken half.
18. **Choose the transport by measuring, not by preferring.** Two candidates, and `docs/research/spike-6-tutor-listening.md` exists to decide between them — read it first:
    - **(A)** Realtime API, audio in / **text out**, keeping its turn detection and listening quality, with the reply synthesized through TTS.
    - **(B)** A turn-based loop whose listening leg is the `gpt-audio` family this repo already trusts for error detection, dropping WebRTC entirely.
    Judge on: does the tutor still catch pronunciation and hesitation errors, and what is per-turn latency. **Default to (A) where they are close**, on the strength of the operator's direct experience. If (A) wins, the WebRTC and ephemeral-secret machinery survives **on merit**, and this milestone's "What this deletes" section shrinks accordingly — say so plainly rather than deleting things to hit a number.
19. **These survive either choice, and are not negotiable.** The **stale-lease overbill** is fixed or deleted (`RESERVATION_STALE_MS` 15 min < `maxTutorSessionMinutes()` 30 min ⇒ a legal 21-minute call bills 1.9×, with server-elapsed resetting and disabling both the duration ceiling and the under-report floor). The **TTS rate** is repriced from per-character to per-audio-output-token (Amendment 1, criterion 12). The **minimum duration** stands (criterion 6). The persona, the guardrails and `log_evidence` stand (criteria 3–4). The recording still lands as a normal session for deep analysis (criterion 5).

---

## Amendment 4 — 2026-07-25 · **spike-6 settles the transport: (A). Read `docs/research/spike-6-tutor-listening.md` before you write anything.**

Measured, not preferred. ~130 live calls, $0.74. See the D-28 addendum in `DECISIONS.md` for the full reasoning; the operative consequences for you:

20. **Build transport (A): Realtime, `output_modalities: ["text"]`, reply synthesized through TTS.** The configuration is confirmed to work — echoed back by `session.updated` over WebSocket **and** accepted by this product's own `/v1/realtime/client_secrets` mint. Server VAD and function tools (so `log_evidence`) work unchanged. **Amendment 1's criterion 11 (streaming TTS mandatory) still binds** — it is now the only place per-turn latency can be won, and (A) measured 2.43 s to first reply audio.
21. **The WebRTC and ephemeral-secret machinery survives on merit.** `lib/tutor/mint.ts` and `lib/tutor/realtime-client.ts` are **not** deleted. Criterion 10 and the "What this deletes" expectation of ~1,000 lines are **withdrawn** — the honest deletion here is Realtime's *audio output* leg and the long-lived lease, not the transport. **Do not delete to hit a number**; state plainly in the PR body that this milestone deletes less than planned and why the measurement changed the answer.
22. **Verify the WebRTC leg end to end — this is the spike's stated gap and it is yours to close.** The session contract was proven over WebSocket; a browser was out of the spike's reach. Drive a real WebRTC session in a real browser against the built app and confirm audio in / text out / TTS reply works over the actual transport, not just the mint.
23. **The money defects survive the transport decision and are still yours.** The stale-lease overbill (criterion 19) is unchanged — if anything more urgent, because the lease survives too. Additionally, from the spike: **`REALTIME_RATES` carries no text-token rates**, so `realtimePerMinuteUsd` over-books **5.1×**. Over-booking is the *safe* direction, but at 5.1× it will refuse a learner who genuinely has budget — a cap that lies in the generous direction is still a cap that lies. Fix it, and keep every leg at or above measured reality. Note the general lesson the spike proves: **a per-minute rate is not a safe floor for short calls**, because the prompt is re-sent every call and a per-minute model charges nothing for it.
24. **State the cost honestly in the PR body.** (A) measures **$0.283 per 10-minute conversation** — cheaper than (B)'s $0.340, far cheaper than today's all-audio Realtime, and **~2.7× more than a pure transcript loop** ($0.10–0.11, spike-5). That premium is the price of D-3 compliance and we are paying it deliberately. Do not present the migration as a pure cost win; it is a quality decision that happens to also cost less than the alternative that would have broken D-3.

---

## Amendment 5 — 2026-07-25 · **Operator ruling after driving the built tutor: revert the speaking leg to Realtime audio-out.**

Verbatim: *"the new tutor is actually worse than the previous one. The UI is better with the progress bar and the five minutes — let's make it ten minutes default. But the TTS/STT infra is really bad, the lag is too high. So let's revert to realtime and default to realtime, OpenAI realtime 2.1 mini."*

This is a scope change from the operator, not a review finding. **The PR is unmerged, so revise the branch rather than merging and undoing.** `docs/research/spike-7-realtime-voices.md` measured the case: Realtime audio-out replies in **1.168 s** to first audio (~1.67 s including the silence window) against this branch's **4.5–5.0 s**, at **2.34× the cost** ($0.66 vs $0.283 per 10 min). The operator has weighed that and chosen latency.

### What is REVERTED

25. **The speaking leg goes back to Realtime audio-out.** Restore `output_modalities: ["audio"]`, `audio.output.voice`, `onRemoteAudio` / `pc.ontrack`. **Delete** the text-out speaking half built on this branch: `lib/voice/*`, `lib/tutor/speak.ts`, `lib/tutor/speech-queue.ts`, `lib/tutor/reply-stream.ts`, the `/api/tutor/speak` route and their tests (≈718 lines of product code, ≈1,180 with tests). Delete the TTS rate work **only where it existed solely for this leg** — but see criterion 29 before removing anything from `rates.ts`.

### What is KEPT — all of it, and this is most of the milestone's value

26. **Everything the operator praised, and everything that was broken before this branch.** The minimum-duration progress UI, the turn-state line, Erika greeting first, the closing line, the `pagehide` beacon. Migration **v29** `tutor_conversations` and its server-measured duration. **The WAV upload fix** — the tutor uploaded a raw MediaRecorder container so *every* conversation was refused `422 undecodable_audio` for two versions; that stays fixed and is verified end to end. The **stale-lease fix** (an assumed-run lease is one unit, never partially resolved) and the revived `isAssumedRunLeaseHash`. The persona additions — **especially "never narrate the tool call"**, which is *more* important with audio-out because the model speaks its own text directly. The `log_evidence` contract. The key-gated live smoke tests.
27. **The minimum duration default becomes 10 minutes** (operator ruling; was 5). It stays settable and shown as progress. D-24 still binds: no countdown, no warning, no guilt copy for leaving early.

### What is NEW

28. **Default model: `gpt-realtime-2.1-mini`** — operator ruling. **But you must verify it before shipping it as the default, and report rather than silently override.** `docs/research/spike-6-tutor-listening.md` measured the mini producing **3 empty replies and 2 hallucinated errors out of 9** on clean speech — which is why this branch deleted the tier knob in the first place. For a tutor, *inventing* a correction is the worst possible failure: it teaches the learner something false about their own Italian and destroys trust in every real correction. So: run at least **12 turns** of the spike's own labelled fixtures through `gpt-realtime-2.1-mini` and record caught / missed / **hallucinated** per turn, exactly as spike-6 did. Ship mini as the default as instructed, and put the measured table at the **top** of your PR body with a plain one-line verdict. If mini hallucinates at a materially worse rate than the flagship, say so in one sentence and let the dispatcher take it to the operator — do not quietly substitute the flagship.
29. **One voice dial, ten options, defaulting to something other than `marin`.** The operator's original complaint — *"it does not speak super well"* — was formed against `marin` alone, pinned as `TUTOR_VOICE` on 2026-07-24 and never changed; they judged one voice out of ten. They have now heard all ten (`alloy, ash, ballad, cedar, coral, echo, marin, sage, shimmer, verse`, in `artifacts/voice-samples/realtime-*.mp3`) but have **not** named a pick. So expose all ten in the Settings dial that already exists on this branch, so the choice is theirs by ear inside the app, and pick any sensible non-`marin` default — say which and why in one line. `nova` is **not** a Realtime voice and cannot be carried over. This remains **one** knob, so the Settings count is unchanged from Amendment 2.
30. **Rates must stay honest through the revert.** Audio-out restores the $64/1M audio-output leg and re-feeds the tutor's own audio into context at $32/1M rather than text at $4/1M. Re-derive the realtime rate for **both** models from measured `usage` (spike-7 measured $0.830/10 min flagship on its assumptions), keep every leg at or above reality as a **floor**, and keep the leg-wise nine-duration sweep discipline this branch introduced. E-42's `tests/rates-text-floor.test.ts` must remain untouched and green. Remove a TTS rate only if nothing still bills TTS — `lib/render/` and the E-33/E-37 phrase renders **do** still bill it, so check before deleting.

### Verification

Drive it in a browser and **state the measured silence-to-first-audio number** in the PR body, the way this branch honestly stated 4.5–5.0 s. The claim being tested is that the revert buys ~1.7 s. Keep the proof-of-which-server discipline. Re-run the mutation proofs that still apply and say which no longer do because their code is gone.
---

## Exit report — 2026-07-25

```
RESULT: done
PR:     https://github.com/immaculatecross/erika/pulls (branch feat/e43-tutor-voice-loop)
```

**Review tier: Full** (unchanged — money, a migration, secrets, an external contract).

### Criterion by criterion

| # | Criterion | Status |
|---|---|---|
| 1 | The loop works end to end in Italian; turns end on silence, not a button | **met — verified live in a browser.** Server VAD with `create_response`/`interrupt_response`; one button to start, one to stop, nothing in between. The tutor caught `ho andato` → `sono andato` and `faccio una decisione` → `prendo una decisione` on planted errors, in Italian, one correction per turn. |
| 2 | A vendor seam matching the house pattern, proven by a second implementation | **met.** `lib/voice/speech.ts` (`SpeechToText` / `TextToSpeech`), OpenAI impls in `lib/voice/openai-speech.ts`, injected by the caller. `tests/tutor-speak-route.test.ts` swaps a streaming fake, a **non-streaming** fake, a failing one and an unavailable one through the same unchanged route. The boundary is bytes + mime, never a vendor object. |
| 3 | Persona and guardrails survive verbatim in force | **met.** `tests/tutor-guardrails-wire.test.ts` asserts each one on the **mint wire body** — the last thing before the network — with expectations taken from `lib/mistakes.ts` itself rather than restated. The register line still composes first. |
| 4 | `log_evidence` survives as a tool call on validated ids | **met, and observed live**: a browser session wrote `rule:noun-gender` and `lemma:il#DET`, polarity 0, mode spontaneous. Contract unchanged. |
| 5 | The conversation still becomes a session | **met — and it was BROKEN before this milestone.** See "what driving found". |
| 6 | A minimum duration, settable and visible | **met.** `tutorMinMinutes` (default 5), a Settings control, and calm progress on the surface (`3:12 of 5:00` plus a hairline). Below it the conversation is real and still logs evidence. |
| 7 | Migration v29 `tutor_conversations` | **met**, documented in `docs/schema.md` in the same PR; contract below. |
| 8 | Money: per-leg, reserve-before-call | **met, with one deliberate divergence** (below). |
| 9 | Rates at or above reality, dangerous direction named | **met**, both directions fixed. |
| 10 | The old transport is gone | **withdrawn by Amendment 4**; partially executed on merit. |
| 11 | Streaming TTS mandatory | **built streaming-first; the measured number is below the bar and is stated plainly.** |
| 12 | TTS repriced by SHAPE, not value | **met.** |

### What this deletes — honestly less than planned

Amendment 4 withdrew the ~1,000-line expectation, and the measurement is why. `lib/tutor/mint.ts` (112 lines) and `lib/tutor/realtime-client.ts` (177) **survive on merit**: spike-6 measured every `gpt-audio` model missing `"ho andato"` in 9 of 9 attempts, with the correction written verbatim in its own prompt, while both Realtime models caught it every time. Deleting them to hit a number would have cost the tutor its core job.

What actually left:

- **Realtime's audio-output leg** — `audio.output.voice`, `TUTOR_VOICE = "marin"`, `onRemoteAudio`, `pc.ontrack`, the downstream `MediaStreamLike` playback path. Small in lines, large in money: it was the $64/1M leg, and removing it is what makes (A) cheaper than (B).
- **The `realtimeTier` Settings knob** — `REALTIME_TIERS`, `realtimeModelForTier`, the segmented control, its validator and its stored key. spike-6 §3.1 measured the model it offered (`gpt-realtime-2.1-mini`) producing 3 empty replies and 2 hallucinated errors on clean speech out of 9 fixtures. A choice between "works" and "invents corrections" is not a feature. Replaced by `tutorRealtimeModel()` — a code default with an env override.
- **`realtimeAudioTokensPerMinute` and the audio-output pricing path** — the 5.1× over-book itself.
- **A private second copy of the container→WAV conversion** in `lib/use-recorder.ts`, folded into `lib/recording.ts` as `toUploadableWav` and now shared with the tutor.

Net: the diff is **positive in lines**. It is **negative in concepts a learner must hold**, and the tutor's entire audio-output half is gone. Stated plainly rather than dressed up.

### The money invariant, and every path that could violate it

*Every billable call reserves before the provider is touched; committed + pending never exceeds the cap; a resolved call is recorded exactly once; a refusal mints nothing; work already on the wire is still recorded.*

The two legs have different shapes because they really are different, not because there are two money paths — both reserve into the one `spend_ledger` under the one cap.

- **Listening (long-lived).** A Realtime session bills while it runs and the server cannot observe its usage turn by turn, so the lease survives, as Amendment 4 requires. The defects do not survive with it.
- **Speaking (bounded).** One server-side call per reply → ordinary reserve-before-call / finalize-on-resolve, **no lease, no heartbeat, and therefore no stale window at all**. This is exactly the shape criterion 8 describes.

**The 1.9× stale-lease overbill is now structurally impossible, not merely fixed.** The mechanism was a *partial* sweep: `RESERVATION_STALE_MS` (15 min) < `maxTutorSessionMinutes()` (30 min), so mid-call the sweep found a lease's oldest rows past the cutoff and its recent ones not, committed the old half, and left the live half for `/end` to bill again. It also moved `MIN(reserved_at)` forward, resetting server-elapsed 20.0 → 0.0 min and switching off **both** the duration ceiling and the under-report floor at once.

Raising the TTL would have fixed the reported instance and left the invariant broken — anyone raising `TUTOR_MAX_SESSION_MINUTES` would silently re-arm it. The invariant is: **an assumed-run lease is ONE unit and is never partially resolved.** Staleness is now judged on the lease's *newest* pending row (`HAVING MAX(reserved_at) <= ?`) and, when stale, every row of that lease is swept together into exactly one committed row. Consequences, each asserted by a test:

- a live call reserves again on each minute it outlasts, so its newest row is ~a minute old and **the sweep cannot touch a live session at any TTL**;
- if extensions stop anyway (the cap refused one, the client froze), the lease is swept **whole** and commits **once**; a later `/end` then finds nothing reserved and commits nothing;
- `tutorLeaseOpenedAtMs` can no longer move forward while a lease is open, because a lease's rows never disappear one at a time.

Opposite failures checked, per "fix invariants, not instances": a charge is never **lost** (an abandoned lease still commits its full reserved sum), never **doubled** (one committed row per lease, and finalize clamps to what remains reserved), the cap is never **loosened** (the committed amount is exactly what the cap already admitted), and an ordinary crashed cascade call still **releases**.

Also closed here, because it lives on the same path: `isAssumedRunLeaseHash` was exported, documented as the authority and **dead** — RETRO-004 proved that dropping its `pa:` clause passed 1012/1012, because the sweep never consulted it. The sweep's SQL is now **generated** from `ASSUMED_RUN_PREFIXES`, and every prefix gets a behavioural test, not merely a predicate test.

Refusal and crash on the speaking leg, both asserted: a cap refusal returns 402 having made **no** vendor call and minted **no** ledger row; a stream that dies with bytes already delivered **still bills** for them; a failure before a single byte **releases**; and `tutor-tts:` is an assumed-run prefix, so a process death commits rather than releases.

### Rates — reconciled against spike-5 and spike-6

| Defect | Before | Now | Direction |
|---|---|---|---|
| `REALTIME_RATES` had **no text-token rates**; `realtimePerMinuteUsd` charged 1500 audio-**output** tokens/min at $64/1M for audio that is never generated | $1.440 per 10 min modelled against **$0.283 measured** — **5.1× over** | $0.5118 for the 10-min listening leg against $0.2075 measured — **2.47× over** | was safe-but-lying; now safe and bounded |
| `TTS_RATES.usdPerCharacter` charged the audio-output-token rate per input character | **1.23×–1.76× UNDER**, voice-dependent | the **shape** changed: characters → audio seconds → audio-output tokens. Effective **$24.15 per 1M characters** (was $12.00) | **the unsafe direction, fixed** |
| No honest post-call TTS charge | n/a — `/v1/audio/speech` returns no `usage` | the mp3 is 128 kbps CBR (all five spike-5 samples divide to exactly 16 000 B/s), so duration comes free from the byte count and the **committed** charge is the real one, clamped to the reservation | more truthful, never higher |

Every constant clears a measured **maximum**, not a mean. `tests/rates-voice-floor.test.ts` pins each leg separately — audio-in, text-out, the cached re-send (which is quadratic in turns and asserted to grow super-linearly), fresh text, and the persona floor against the real `buildTutorPersona` at its own caps — across nine durations from 20 s to 30 min. `tests/rates-text-floor.test.ts` is untouched and still green; this is its companion, not its replacement.

Two spike-6 findings sit **outside this milestone's surface** and are therefore reported, not diffed: `gpt-audio-mini` under-priced on the **analysis** path (E-42 already pins its floor), and `"vocabulary and word choice"` missing from `CATEGORY_ALIASES`, a live Record-path bug.

### Live API results — everything below was really run

The key came from `.env.local`, was never printed, and is not in the diff.

**Key-gated smoke tests (OBS-001, owed since v0.5)** — `tests/live-voice-smoke.test.ts`, five tests, skipped entirely without a key, **all passed first try**:

- `POST /v1/realtime/client_secrets` with the product's own allowlisted body → **HTTP 200**, an `ek_…` secret, and `output_modalities: ["text"]` **echoed back in the response**. spike-6's gating fact, re-confirmed from product code rather than a hand-written approximation.
- TTS blocking → mp3, with a plausible duration derived from the byte count.
- TTS **streaming** → the SSE stream decodes to audio.
- STT parses a scripted, known-answer clip (D-21's allowance only — never free speech).

**The WebRTC leg, end to end in a real browser — spike-6's stated gap, now closed.** The built server (`next start`) on a random high port with a disposable database, and Chromium with a fake microphone fed real synthesized Italian containing planted errors.

- `pc:connecting → pc:connected`: a real `RTCPeerConnection`, a real SDP offer/answer against `/v1/realtime/calls`, authorized by the ephemeral secret alone.
- **The GA text event names, measured**: `response.output_text.delta` / `response.output_text.done`. The code accepts the beta `response.text.delta` as well — a hard-coded wrong name would have left the tutor permanently silent with every test green, the same class of failure as the mint allowlist.
- Full observed event set: `session.created`, `input_audio_buffer.speech_started` / `speech_stopped` / `committed`, `response.created`, `response.output_text.delta` / `.done`, `response.done`, `rate_limits.updated`. **Zero `error` events, zero page errors, zero console errors.**
- Real corrections, in Italian: *"Hai detto «ieri ho andato» — si dice «ieri sono andato»."* and *"Hai detto «faccio una decisione» — si dice «prendo una decisione». È una collocazione fissa."* — one per turn, each followed by a question that kept the conversation going.
- `POST /api/tutor/speak` returned **200** on every chunk; clips played in order.
- The disposable database afterwards: a `tutor_conversations` row with server-measured `duration_seconds`, `met_minimum = 0` (46 s against a 300 s minimum — correct), and `session_id` linked by capture time; a `sessions` row (`Recording … .wav`, 47.28 s); `evidence` rows written by `log_evidence`; a ledger with one committed `gpt-realtime-2.1` row and one committed row per TTS chunk and **no pending remnant**; migrations at **v29**.

**Keyless walk, same discipline.** `GET /api/tutor/session` reports `keyConfigured: false`; pressing Start yields *"Erika needs an OpenAI API key to hold a conversation."* with a working **Open Settings** link that lands on `/settings`; Settings shows the voice dial and the minimum, and **no** tier control. `spend_ledger` has **0 rows** and `tutor_conversations` has **0 rows** — a failed start mints nothing and leaves no phantom conversation in the day's history.

### What the learner actually experiences (criterion 11, measured)

Measured on the built app in a browser, timed from the server's own `input_audio_buffer.speech_stopped` — the VAD hangover included, spike-6's own definition:

| | measured |
|---|---|
| Cold start: click → Erika's first word | **4.48 s** (mint + `getUserMedia` + SDP handshake + generation + TTS) |
| Learner falls silent → first text of the reply | **2.1–2.6 s** |
| Learner falls silent → **first audio of the reply** | **4.5–5.0 s** (an earlier single-turn run: 3.9 s) |

**This is worse than the 2–4 s band and worse than spike-6's 2.43 s projection, and I am not going to dress it up.** The loop is built streaming-first — per-sentence chunking, synthesis pipelined so only the first chunk's round trip is on the critical path, playback strictly ordered, barge-in cancelling requests, queue and playback together — and it is emphatically not the blocking implementation criterion 11 forbids. The gap is in the two legs, not the wiring: spike-6's 1.194 s to-first-text was measured with a **1 365-token JSON-extraction prompt**, while production sends a **~2 700-token persona** and the flagship spends reasoning tokens; TTS then adds ~1.0–1.3 s. Two levers remain and both belong to a later milestone: a shorter persona (which trades directly against the guardrails), and `MediaSource` playback instead of buffering each clip (worth roughly 0.3–0.4 s).

### What driving the built app found that no test could

Two defects, both invisible to 1 238 passing tests.

1. **The conversation never became a session.** The tutor uploaded its raw `MediaRecorder` container. A live MediaRecorder stream carries **no container duration**, so the server's ffprobe cannot read one and the finalize gate answered **422 `undecodable_audio`** — for every conversation, across two versions. Criterion 5 was quietly false. The Record tab has re-encoded to WAV since E-16b; the tutor never got it. The conversion is now **one shared helper** (`toUploadableWav` in `lib/recording.ts`) used by both, and `lib/tutor/take.ts` makes the sequence testable in Node with no DOM.
2. **The tutor narrated its own bookkeeping out loud** — *"un momento, registro un dettaglio su ciò che hai detto"*, *"mi concentro su una correzione chiave e poi continuiamo"*. The learner heard the machinery instead of a conversation, and it cost a whole spoken sentence of latency before anything useful was said. No test could have caught it: the text was perfectly good text. The persona now forbids it and the wire test asserts the clause.

### Mutation proofs — 10 of 10 killed

Each guard broken, run red, restored, run green.

| | mutation | broken | restored |
|---|---|---|---|
| M1 | sweep a tutor lease per row again (the 1.9×) | 3 failed / 11 | 11 passed |
| M2 | let the client **raise** the credited duration | 3 failed / 20 | 20 passed |
| M3 | read the minimum live instead of the one stored at open | 1 failed / 20 | 20 passed |
| M4 | price TTS per input character again | 4 failed / 22 | 22 passed |
| M5 | drop the realtime text-output leg | 1 failed / 22 | 22 passed |
| M6 | drop `output_modalities` from the mint allowlist | 2 failed / 12 | 12 passed |
| M7 | upload the raw recorder container instead of WAV | 1 failed / 12 | 12 passed |
| M8 | book the persona at spike-6's smaller prompt | 1 failed / 22 | 22 passed |
| M9 | let the tutor narrate its bookkeeping again | 1 failed / 28 | 28 passed |
| M10 | flush a turn's tail without speaking it | 3 failed / 17 | 17 passed |

**M3 and M9 SURVIVED the first pass**, and that is reported rather than quietly repaired: the "minimum copied in at open" rule was only exercised by changing the setting *after* the close, and the anti-narration clause had no test at all. Both now have one, and both kill.

### Proof of which server answered

Two independent proofs, both required to pass or the run aborts before touching anything.

1. **Process identity** — a random high port (39 000–41 000), then `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` compared against the transitive descendants of the pid this run spawned. Observed: spawned `46791`, listening `46814`, a descendant. No foreign listener.
2. **Build identity** — `GET /api/tutor/session` must return `minSeconds`, `voice` and `keyConfigured`, three fields **only this build emits**. Observed `{ minSeconds: 300, voice: "female", keyConfigured: true, model: "gpt-realtime-2.1" }`. A leftover older server on that port would have answered without them and the run aborts.

### The `tutor_conversations` contract WO-E44 consumes

```sql
CREATE TABLE tutor_conversations (
  id               TEXT PRIMARY KEY,   -- the tutor session id == the spend lease key
  started_at       TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at         TEXT,               -- NULL = live, or abandoned
  duration_seconds REAL,               -- SERVER-measured; NULL when never closed
  min_seconds      INTEGER NOT NULL,   -- the minimum IN FORCE AT OPEN, copied in
  met_minimum      INTEGER NOT NULL DEFAULT 0,
  session_id       TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  local_day        TEXT                -- the LOCAL day it closed on (D-24)
);
```

Read it through `lib/tutor/conversations.ts`, never raw:

- **`metMinimumOnDay(db, day) → boolean`** — the one question E-44 asks.
- `conversationsForDay(db, day)` — every CLOSED conversation that day, newest first.
- `openConversation` · `closeConversation` · `closeAbandonedConversations` · `linkRecordingByCaptureTime`.

Three properties E-44 can rely on. **Duration is server-measured and a client may only LOWER it** — the money path takes the opposite side, where the server floors the client, and each direction is the conservative one for its own question. **Closing is idempotent**, so a retry or the `pagehide` beacon racing the End button cannot double-credit or rewrite a recorded day. **An abandoned conversation is recorded with a NULL duration and no credit**, because the honest answer to an unknown is not a favourable guess.

### Product calls

Argued at length in the PR body; named here.

1. **Erika greets first.** A `response.create` on channel open. Without it a first-timer meets silence and cannot tell whose turn it is.
2. **A turn-state line** — "Listening — just talk" / "Erika is speaking" — because in a voice UI, whose turn it is, is the single most important thing on screen.
3. **The reply text is never shown.** We have it; showing it would invite reading instead of listening and would add a surface D-26 wants removed.
4. **The minimum is stated in Settings as well as shown on the surface**, so the rule is explained rather than left as a mysterious bar.
5. **`nova` (female) is the default voice**, because the product is named Erika and speaks as Erika throughout its copy; either operator-chosen voice was acceptable.
6. **The closing line follows what actually happened to the take**, and says nothing at all about falling short (D-24).
7. **A `pagehide` beacon** closes the record honestly when a tab is closed, rather than leaving it to the abandoned-conversation sweep to write off as unknown.
8. **`SPOKEN_OUTPUT` and the anti-narration clause** were added to the persona — the first because a model writing for a screen produces markdown a voice reads aloud as punctuation, the second because the live tutor demonstrably narrated its own tool call.

### Divergences from the work order, stated

1. **Criterion 8's "no lease"** is not implemented, because Amendment 4 keeps transport (A) and a Realtime session genuinely is long-lived. The lease survives; the **defects do not**, which is what D-28 actually requires. The speaking leg is precisely the lease-free shape criterion 8 describes.
2. **Criterion 10** is withdrawn by Amendment 4. The parts of it that survive on their own merit — `realtimeTier`, the audio-output leg — were executed.
3. **Criterion 11's latency target is not reached** — 4.5–5.0 s against a 2–4 s band. Reported rather than hidden; the implementation is streaming-first as required.
4. **Settings gains two knobs and loses one** (net +1), where Amendment 2 wanted the voice to be the only addition. A learner cannot evaluate a model tier but can evaluate a voice and a duration, and stating the rule beats leaving it a mystery behind a progress bar. If the dispatcher disagrees, the minimum can move to a code default in one line.

### Spend

**≈ $0.12 of real money** against the $1.50 ceiling (~8%). Modelled from the published per-token rates, not an invoice:

| item | approx USD |
|---|---|
| 5 key-gated smoke tests (1 mint, 3 TTS, 1 STT) | 0.002 |
| fixture synthesis (4 Italian clips, wav) | 0.011 |
| 3 live WebRTC browser sessions (35 s + 46 s + 20 s of `gpt-realtime-2.1`) | ~0.090 |
| 14 TTS reply chunks across those sessions (~60 s of speech) | 0.015 |
| **total** | **≈ 0.118** |

No call was refused, rate-limited or 5xx'd; the ceiling was never the binding constraint. Modelled ≠ invoiced — the standing reconciliation is unchanged.

**And the migration's cost, stated the way Amendment 4 asks.** Transport (A) measures **$0.283 per 10-minute conversation** — cheaper than (B)'s $0.340 and far cheaper than the all-audio Realtime path it replaces, but **~2.7× a pure transcript loop** ($0.10–0.11). That premium is the price of D-3 compliance and we are paying it deliberately, because `whisper-1` was measured silently repairing this project's own planted errors. This is a quality decision that happens also to cost less than the alternative that would have broken D-3 — not a cost win.

### Verified

```
npm run lint · npx tsc --noEmit · npm run test · npm run build   — all green
npm run test → 143 files passed, 1 skipped · 1252 passed, 5 skipped
```

Every verification ran against a **disposable database** (`ERIKA_DB_PATH` and `ERIKA_DATA_DIR` under `mkdtemp`). One correction mid-run, recorded rather than hidden: an early walk set only `ERIKA_DATA_DIR`, so the database went to the repo's default `data/erika.db`. That worktree-local file was deleted and the harness fixed to set both variables.

### Tests changed or removed

- `tests/settings.test.ts` — `realtimeTier` cases replaced by `tutorVoice` / `tutorMinMinutes`, **plus a new case** proving a database that stored the removed key still reads.
- `tests/tutor-persona.test.ts` — config shape updated (`output_modalities`, `audio.input.turn_detection`); "follows the tier switch to mini" became "pins the flagship regardless of what Settings holds".
- `tests/tutor-realtime-client.test.ts` — the now-dead `ontrack` fake removed.
- `tests/tutor-mint-body.test.ts` — the allowlist literal widened by `output_modalities`, which is the deliberate edit that test exists to force.
- `tests/tutor-money.test.ts` — **one assertion deleted**: "books at least 1200 audio-OUTPUT tokens per minute". Under D-28 no audio output is ever generated, so booking it *was* the 5.1× over-book. Replaced by the leg-wise floors in `tests/rates-voice-floor.test.ts`.

### Risks

- The **4.5–5.0 s** per-turn figure is the honest weak point and sits above the band.
- The `2.5×` upper bound in the rate-band test is deliberately tight (currently 2.47×) and will trip on a small legitimate change — by design, but a reviewer should know before reading it as a flake.
- Latency and accuracy are `n=4` turns on **one synthetic fixture**. TTS speech is unnaturally clean and real learner audio is not measured here — the same limit spike-5 and spike-6 both flag about themselves.
- `MediaSource` playback and a shorter persona are the two remaining latency levers, both out of scope.
- `openAiSpeechToText` ships used only by its own smoke test, kept clean and importable for E-45/E-46 exactly as the work order asks.

### Not verified

- Any **invoice**. Every dollar figure here is modelled from published rates.
- Accuracy on **real** learner speech.
- Safari and Firefox (Chromium only).
- The two spike-6 findings on the Record path (`gpt-audio-mini`'s ledgered rate, the `"vocabulary and word choice"` alias) — reported, not diffed; another milestone's surface.
