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
