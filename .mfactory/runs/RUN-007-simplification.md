# RUN-007 — v0.7 the simplification (E-42…E-46)

Date: 2026-07-25 · Mode: direct · Dispatcher: Claude Opus 5 (1M), local session · Target: github.com/immaculatecross/erika

Filed here rather than in `mfactory-v2/runs/` because **no mfactory checkout is reachable from this machine** (`../mfactory-v2`, `~/mfactory-v2` and the sibling desktop path all absent). Sync back to the mfactory archive when a checkout exists — part of filing, not a favour (mfactory D-17).

## Preflight (dispatch.md step 4)

- [x] `<mfactory>` — **not reachable**; the pinned kit at `.mfactory/` is the fallback, as `HANDOVER.md` sanctions. Kit last synced 2026-07-21 against mfactory D-01…D-17; it is frozen for this run (M-2).
- [x] Harness answers: Claude Code, Agent-tool dispatch (cloud-mode plumbing per `HANDOVER.md` §Cloud dispatcher sessions — no `claude -p`).
- [x] Author identity authenticated: `gh auth status` → `immaculatecross`, scopes `gist, read:org, repo, workflow`.
- [x] Reviewer identity: single-identity fallback (Erika D-11 — branch protection is deliberately zero-required-approvals; the dispatcher merges on the reviewer session's verdict). Reviewers are fresh sessions that never see the builder's reasoning.
- [x] Target repo remote + branch protection verified live: PRs required, `required_approving_review_count: 0`, `required_linear_history: true`, `allow_force_pushes: false`, **`required_status_checks.contexts: ["gates"]`**. → **The dispatcher-owed item STATE.md still lists as open ("add the `gates` CI check to branch protection") is already done.** Corrected in STATE at close.
- [x] Node 20.9.0 · ffmpeg 7.1 · ffprobe 7.1 — all present (D-7).
- [~] **Gates green on `master` before dispatch — with one honest exception, recorded rather than waived.** `lint` clean, `typecheck` clean, `build` clean, `test` **1010/1012**. Both failures are in `tests/coldstart-keyless-worker.test.ts` and both are the *same defect in the test*, not in the product (see below). CI is green on the same commit because CI has no `.env.local`. Not treated as a poisoned baseline: the failures are host-dependent and fully explained, and the fix is assigned inside this run (WO-E42).
- [x] Work orders written at `.mfactory/work-orders/WO-E4{2,3,4,5,6}-*.md`, every section filled.

### Preflight finding — the flagship cold-start test is only "keyless" on an unconfigured machine

`tests/coldstart-keyless-worker.test.ts:49` spawns `scripts/worker.ts` with `cwd: process.cwd()`, so the worker loads the **repo's real `.env.local`**. On the operator's machine the key is present, so:

1. the assertion `expect(out).toMatch(/ingest will run normally/i)` fails — the worker printed its *keyed* startup line;
2. the second test's assertion that analysis fails with `"no OPENAI_API_KEY is set…"` fails because the worker **made a real, billed call to OpenAI** and got back `gpt-audio call failed: 500 Internal S…`.

The test that exists to prove v0.6's cold-start blocker stays fixed is therefore green in CI, red on a developer machine, and **spends money when it runs**. It is the third instance in this repo of a test whose subject is not what it claims (v0.6's `decodeURIComponent` grep; the hand-built Next route context; now this). Assigned to WO-E42 with the invariant stated: *a cold-start test must construct the cold start, never inherit the host's.*

## Mission

Operator, 2026-07-25, verbatim in substance: *"Enrich the current v0.7 … this is not really a great polished usable consumer product … a good consumer product like Duolingo would have just one session per day, very clear, no questions asked, super polished, super straightforward"* — plus a specific defect and direction list (realtime tutor speaks poor Italian → TTS+STT; simplify the lesson; flashcards showing the literal word "grammar"; force onboarding on an empty DB; no buttons on the recording path; hide live costs; show progress). Restated mid-planning: *"we did lots of things maybe overcomplicating a lot of stuff. We wanna have a sleek consumer product."*

Ratified as **D-26** and scoped as **v0.7 = E-42…E-46** in FEATURES.md. Operator answers taken at dispatch time: simplify **absorbing** the E-39 owed defects on each rewritten surface; demote-don't-delete with demoted surfaces allowed back into the daily flow where they earn it; **live-API spend ceiling $5** for the whole run; progress gets a real surface.

## Timeline of facts

- 2026-07-25 09:20 — Fetched origin; local `master` already at `11eaa14`… (`11aeb14`), no drift. Five stale remote `fix/*` branches noted, not touched.
- 2026-07-25 09:24 — OpenAI key verified **valid** (bogus key → 401, real key → 500) but the API was in *Partial System Degradation* returning HTTP 500 on every endpoint. Recorded because it gates the live-verification parts of this run.
- 2026-07-25 09:30 — Recon of the six user-facing flows completed (findings folded into the work orders).
- 2026-07-25 09:35 — Baseline gates run; preflight finding above recorded.
- 2026-07-25 09:36 — Inherited **PR #66** (`feat/e39-catch-all-mistakes`, WO-E39 workstream A, gates green, `MERGEABLE`/`CLEAN`) found open from a prior session. Full review dispatched.
- 2026-07-25 09:36 — Voice spike dispatched (live measurement, ≤$1 of the $5 ceiling) → `docs/research/spike-5-voice-loop.md`.

<!-- appended as the run proceeds -->

## What broke or fought back

- **The cold-start keyless test inherits the host environment and bills for it.** Symptom → root cause → fix: see the preflight finding. Assigned WO-E42. OPEN until then.
- **OpenAI degraded during planning.** All endpoints 500 at 09:24 UTC. Mitigation: the spike retries with backoff and is briefed to deliver a partial, labelled result rather than fabricate numbers.

## Component scorecard (worked | fought | broke)

| Component | Verdict | One-line note |
|---|---|---|
| Work order (template + this instance) | | |
| `task.md` worker | | |
| `review.md` reviewer | | |
| Dispatch loop (`dispatch.md`) | | |
| Hooks & gates | | |
| Artifacts (STATE/LOG/FEATURES fidelity) | | |

## Signals (countable facts)

| Signal | Value |
|---|---|
| Sessions: workers / reviews / other | 8 workers (incl. 2 rebase passes) / 9 review passes / 4 spikes + 1 recon + 2 gate attempts |
| Outcomes: first-pass approvals / repairs / escalations | **2** (#66, #79) / **4** (#71, #74, #82, #85) / **0** |
| Routing misses · hook blocks · interruptions | 1 misaddressed agent message (dispatcher) · tripwire ×1, 500-line ×3, commit-msg ×1 · operator steered ~15 times, all incorporated |
| Cold-start walkthrough | **WAIVED by the operator** after 4 attempts were killed by platform failures (529 ×3, watchdog ×1) before producing a verdict. Dispatcher ran a targeted substitute on final master against a fresh DB — all 5 deep links 307 → `/welcome`, the `RSC: 1` bypass returns `NEXT_REDIRECT` with no content leak, `/welcome` states key + cap + worker, migrations v30. **Still unverified: the newcomer-follows-README path, and record → findings end to end on the final tree.** |
| Failure-path walkthrough | **RAN. 3 WALLs, 6 LIEs.** Worst: the tutor reporting a permanently revoked key as *"just now"* with no control — the v0.6 defect, on the milestone built to replace it. 5 fixed on `fix/v07-failure-paths`; 4 cut by operator ruling as demoted-surface polish. |
| Live API spend (ceiling $5.00) | **≈ $2.60** — spike-6 $0.74, E-43 $0.68 across two passes, spike-7 $0.18, reviewers $0.13, E-46 $0.018, E-42 $0.086, others <$0.01. Largest single item reversed an architecture decision. |
| Agent deaths | **≈ 19** — 4 network, 1 Claude spend limit, 3 × 529 Overloaded, the rest watchdog stalls on long turns. **Nothing durable lost**, via push-after-every-file, incremental verdict files, and worktree rescue before relaunch. |
| Wall clock per role (workers / reviews / dispatcher) | not instrumented — n/a |
| Tokens per role, where the harness reports them | subagent totals reported per completion; ≈ 6.0M across all agents |

Pass ledger:

- `PR-66 (WO-E39 workstream A, inherited)`: **first-pass**
- `WO-E42-capture-without-buttons`: **repaired** (1 cycle: 3 blocking → delta APPROVE)
- `WO-E43-tutor-voice-loop`: **repaired** ×2 (an operator-directed architecture reversal, then 1 repair cycle on the money review)
- `WO-E44-one-session-a-day`: **first-pass** (APPROVE, no blocking; a separate rebase pass after E-43 merged)
- `WO-E45-lesson-and-deck`: **repaired** (1 cycle: 2 blocking in the voice path → delta APPROVE; then a rebase that found the defect still live on the daily flow's own component)
- `WO-E46-first-run-and-progress`: **repaired** (1 cycle: 1 blocking → **delta re-review never completed**, verified by reading — the version's weakest proof, recorded as such)
- `fix/v07-failure-paths`: **open** — 4 of 5 findings pushed, scope cut to land

## Lessons (D-09: each names its encoding, or is marked OPEN)

- L: A test that constructs a "clean" environment by *omission* inherits whatever the host supplies — and can silently reach a live, billed API from a developer's machine. → encoded as: WO-E42 criterion (explicit env construction + a no-network assertion), pending.

## Verdict

<!-- filled at mission end -->

---

## E-42 — merged 2026-07-25 (PR #71, `cfb9d20`)

**Outcome: `repaired` — one repair cycle, then APPROVE.** 84 files, +3,683/−858 at first submission; **1130 tests** at merge (from 1012 at v0.6 close). Worker spend $0.086; reviewer $0.117 across two passes.

**Timeline.** Worker dispatched → PR #71 opened → **CI red on Tripwires** (a test fixture literal matched the API-key pattern) → fixed → spike-6's live-API bug routed in mid-flight → independent Full review returned **REQUEST-CHANGES** with 3 blocking → one repair cycle closed all of them → **delta re-review APPROVE**.

**What the gates and the review caught that the worker's own green run did not:**

1. **A tripwire fires in CI on `--all` that the pre-commit hook did not fire on staged files.** Recorded as a lesson below.
2. **A test that could not fail** (B1): `tests/capture-time.test.ts` asserted migration v28's backfill against a hand-typed copy of the statement — deleting the backfill from the *real* migration left 1107/1107 green. The repair rebuilt it to run the real migrations against a v27 database, and it now also catches the subtler mutation (`datetime('now')`, which satisfies "not null" while destroying every date). **Fifth instance of this class in two versions.**
3. **The standing-clause bar was judged, and initially failed.** The reviewer's first verdict: the mic→findings path is genuinely zero-decision, but *"nothing in the product tells a newcomer to run `npm run worker`"* — the same failure that made v0.6's cold-start gate FAIL. Promoted from a note to a required repair; now on the first paint of the empty home, rendering once when empty and **zero** times once a session exists.

**Findings priced and deferred (D-15), all inside v0.7:** copy saying a run costs *"roughly twenty cents"* against a real $0.30–$0.75 → **E-46** (owns disclosure copy; D-26 says the app must not lie about cost, so this is not dropped); the upload acknowledgement has no expiry → close sweep; three unused imports → close sweep. A register slip yielding the card front `Non ____` → **E-45**, whose totality proof covers it.

**Notable in the work itself.** The money change was the run's highest risk — the PR rebuilt `rates.ts` and *lowered* `gpt-audio`'s per-minute figure, this repo's explicitly dangerous direction. The reviewer did not check the arithmetic; it **measured** it, with one real `gpt-audio-1.5` call using the app's own prompt, and found real cost $0.0279 against a modelled $0.0385 (1.38× over), rising to 4.12× over on a 5 s turn. **Short calls, previously the dangerous case, are now the safest.** The prose claim "the total per call still rises" was false above ~2.08 min; it is replaced by the real per-model crossovers (3.49 / 0.96 / never) **enforced by a nine-duration × every-model floor sweep** rather than asserted in comments.

**The worker found its own mirror image mid-repair** — its first upload-acknowledgement implementation identified the new row by "newest `created_at`" and picked the wrong row for same-second uploads, the exact hazard v27 needed a sequence column for. It caught this because the work order required asking what the opposite failure looks like. First evidence that the "fix invariants, not instances" rule is being applied prospectively rather than in hindsight.

**Two debts carried forward, named not silently dropped:** `REALTIME_RATES` has no text-token rate and over-books 5.1× (→ E-43); `lib/knowledge/derive.ts` counts `distinctCorrectDays` from evidence *mint* time rather than capture time — the same invariant on the wrong clock, deferred because changing it changes D-19's `known` gate (→ E-45).

### Lesson from this milestone

- L: **"Gates green locally" is not "gates green in CI"** — the pre-commit hook tripwires *staged* files while CI runs `--all`, so a worker can believe itself clean and still turn CI red. → encoded as: the worker was asked to diagnose rather than accept the dispatcher's hypothesis; **OPEN** pending its stated cause in the exit report. Every subsequent WO in this run should require `run-tripwires.sh --all` before opening a PR.

---

## E-43 — merged 2026-07-25 (PR #74, `b48f9ce`)

**Outcome: `repaired` twice — an operator-directed architecture reversal, then one repair cycle.** 39 files, +4,318/−330. Worker spend $0.68 across both passes; reviewers $0.168.

**The arc matters more than the diff.** D-26 ruled the tutor should become STT → LLM → TTS. The operator's own correction (*"for listening… I think realtime might be good"*) caught a flaw before a line was written: a transcript would have made the tutor detect mistakes from text, which **D-3 forbids for exactly this reason**. `spike-6` then measured that claim rather than asserting it — `whisper-1` silently *corrected* the planted errors, `familia` → `famiglia` — and D-28 split the legs: listening stays native, only speaking changes. The operator then drove the built result, rejected its 4.5–5.0 s lag, and reverted the speaking leg too (Amendment 5). **The milestone ended roughly where it started architecturally, and that is not waste** — every step was decided by measurement, and the money and correctness defects found along the way were real and are fixed.

**Three defects that only driving could find, all invisible to a green suite:**

1. **The tutor's correction was never spoken.** `call_id` was extracted and **discarded**, so `function_call_output` never returned and the model stalled after a holding line — **5 of 9 labelled fixtures**, every one a turn that called `log_evidence`. The tutor went silent *precisely* when it had something to correct. The delta reviewer reproduced it on the live wire and confirmed the fix: *"Hai detto «ieri ho andato» — è «ieri sono andato»…"*
2. **Every tutor conversation had been refused `422 undecodable_audio` for two versions.** The tutor uploaded a raw MediaRecorder container carrying no duration; the Record tab has re-encoded to WAV since E-16b and the tutor never got it. E-34's criterion 5 was quietly false since it shipped.
3. **`response.output_audio.delta` never arrives over WebRTC**, so "Erika is speaking" never showed while she was.

**Money.** The 1.9× stale-lease overbill is fixed at the invariant (an assumed-run lease is one unit, never partially resolved) and `isAssumedRunLeaseHash` is no longer dead. **The rate story is the run's best example of measurement outranking authority:** the money review prescribed `audioOutUsd` at 700 tok/min; the worker overrode it at 1200 on live `usage`; the delta reviewer then *independently* measured **exactly 20.000 tok/s on both tiers** and identified the earlier 9.93 as an **audio-input** figure — Realtime bills output at exactly double input, so **the prescription would have under-booked**. Verified across 17 durations × 2 tiers: worst 1.775× over, **never under**. The floor test was genuinely replaced (it goes red on the reviewer's own 700), not sign-flipped.

**Measured latency:** 740 ms `speech_stopped` → first audio (worker: 541/936 ms), against 4.5–5.0 s for the TTS path. Cost: flagship $1.6188 booked / ~$0.83 real per 10 min; mini ~3.5× cheaper.

**Deferred, recorded with owners:** two surviving mutations (`cachedInputRate` `max`→`min`; `FRESH_TEXT_TOKENS_PER_MINUTE` 600→1) → close sweep. The cost *shown* is the model, not the invoice, though the browser already receives the `usage` that would fix it → the cost-optimisation mission. `log_evidence` costs one extra billed response per logged turn → same mission. **A daily 10-min flagship conversation models 100.4% of the $50 cap** — raised to the operator, who ruled it not a concern for now.

### Lessons

- L: **An operator's product instinct can catch an architectural error no review would have.** D-26's transport ruling would have broken D-3; the operator's "realtime might be good for listening" caught it before code existed. → encoded as: D-28, and the practice of measuring a founding claim rather than citing it (`spike-6` re-proved D-3 empirically).
- L: **A prescription from a review is not automatically right; measurement outranks it.** The money review's 700 tok/min would have under-booked. The worker overrode it *and said so explicitly*, and an independent reviewer confirmed the override. → encoded as: the standing instruction that a worker may contradict a criterion provided it says so and argues it (D-26 product-authority clause), now validated on a money path.
- L: **`npm run lint` was a no-op in every nested worktree** — ESLint walked into the parent checkout, hit a duplicate `@next/next`, and aborted before linting a single file. Every worker in this run reported false-green or unverified lint. → encoded as: `"root": true` in `.eslintrc.json` (PR #78), reproduced and verified in both directions before landing.

---

## Where this session stopped — 2026-07-25 evening (operator ending the session)

**Merged and green on `master`:** E-42 (#71) and E-43 (#74), plus the plan (#67), spike-5 + WO amendments (#68), the product-authority clause (#69), D-27/D-28 (#70), the E-42 ritual (#73), the E-45 speaker-predicate withdrawal (#75), the E-43 revert amendment (#76), cost visibility (#77), **the ESLint fix (#78)**, the E-43 ritual (#81) and the E-46 calibrated-day-one amendment (#80).

**Open, with exact next actions:**

- **PR #79 — E-44 "one session a day".** Built, gates green **against its own branch**, but master has moved. **Rebase first, then review** — reviewing the pre-rebase head wastes the pass, which is why the review dispatched here was not resumed after it stalled with a 963-byte stub. The rebase is **mechanical and fully scoped**, because building a local preview of E-43+E-44 forced it already:
  1. `lib/migrations/index.ts` — each branch deleted the other's registration. Register **both** `tutorConversationsMigration` (v29) and `dailySessionsMigration` (v30). *This is the migration-registry family of hazard that left v0.6 databases unbootable — do not hand-wave it.*
  2. `docs/schema.md` — one version line (`tests/migrations.test.ts` pins the pairing).
  3. `tests/session-day.test.ts` — its `createConversationRecord` helper creates `tutor_conversations` with hand-written DDL; that table now exists for real, so `Database.exec` throws. **5 call sites.** Use the real migration.
  4. Knock-ons in `tests/session-plan.test.ts`, `tests/session-store.test.ts`, `tests/today.test.ts` — same root cause.
  **14 tests across 5 files.** The runtime composes fine: a preview merge booted on a fresh database, migrations reached **v30** (v29+v30 both applied), every probed route 200, tutor estimate `$1.6188` at `minSeconds: 600`, voice `alloy`, flagship. E-44's own worker predicted (3) and warned to re-walk the conversation step after rebase; it did **not** predict (1).
- **E-45 "the lesson and the deck"** — mid-build on `feat/e45-lesson-and-deck`, work pushed, no PR. Last: *"an unteachable rule substitutes, never 404s."* Carries the handed-over truncation defect (a billed item-lesson call that returns nothing; `ITEM_LESSON_MAX_OUTPUT_TOKENS = 1400` short of the prompt's own 3–5-exercise contract).
- **E-46** — not started. Work order amended with three criteria for a **calibrated day one** (the first session composed from the placement result, asserting the positive; the spoken prompts shown to move the estimate or honestly stated not to; a learner who declines to speak still calibrated).

**Run health:** ~13 agent deaths — 4 network, 1 Claude spend limit, the rest stream-watchdog stalls on long turns. **Nothing was lost.** The discipline that did it: push after every *file* (not every milestone), write review verdicts to disk incrementally, and rescue an agent's worktree before relaunching. Two dispatcher errors worth recording: a rescope message **misaddressed** to the E-44 worker instead of the E-43 money reviewer (the worker confirmed it touched nothing outside its lane), and a rescue that ran `git add -A` inside a live agent's worktree, leaving a staged index it had not created — **capture patches to scratchpad instead**.

**Live spend:** ≈ $2.16 of the operator's $5 ceiling. Largest single item: `spike-6` at $0.74, which proved keeping Realtime for listening was right and re-proved D-3 empirically.

**Preview for the operator:** `/tmp/erika-preview` (local-only merge of E-43+E-44, throwaway DB at `/tmp/erika-preview-data`). Disposable — delete once #79 merges.

---

## E-44 — merged 2026-07-26 (PR #79, `169debd`) · first pass APPROVE

47 files, +4,105/−766. **1332 tests.** Worker $0.0024, rebase worker, reviewer $0.0011.

**The milestone v0.7 is judged on.** Learn is one screen — ring, streak, one control — and behind it a linear resumable session (lesson → drills → weekly letter → conversation → done) at `/practice/session`, with focus, phrasebook, archive, slips, readings, shadow, studio, pattern lessons, the card browser, the tutor and placement all behind one `/library` entry. Nothing deleted; 12/12 deep links verified resolving. The whole **section sub-navigation tier** is gone.

**Its structural answer to "no step may end at a wall" is better than the work order asked for:** *a step Erika cannot deliver is not in the session at all* — never rendered as a row that refuses, because a row that refuses is a wall with a coat of paint. `planSession` decides server-side. The one step that cannot be dropped, the lesson, degrades to **E-26's syllabus content authored for all 266 rules** (title, description, correct examples, committed, verified `0 missing`), so it teaches with no key, no budget and no network. Copy rules are **enforced by tests**, not prose: a standing condition may never be softened to "right now"; a notice mentioning Settings must carry a link resolving to a page **on disk**; a retry is offered only where retrying can change the outcome.

**Two defects found by driving, invisible to the suite:**
1. **The drills step completed itself** — `cardsReviewedToday >= plannedCards` is trivially true at **zero** planned cards, i.e. exactly the recording-less day D-27 made primary. The whole day closed the instant the learner pressed Start.
2. **The day was never recorded when the last step completed by observation** — the conversation is the only step with no POST. Session read `complete: true` while `day_ledger` stayed empty: no sentence, no ring, no streak day, for a learner who finished exactly as designed.

Both generalised, not patched: `markStepDone` is the sole writer of `done_steps`, reachable only from `reconcileSession` (observation, may complete) and the step route (a claim, may only refuse). **The distinction is structural, not per-site.**

**Criterion 11, answered honestly rather than hidden:** a learner on day one with no placement and no recordings gets a **generic** session — rule #1 at A1. The differentiator switches on only once they place or record. That admission produced the operator's ruling and **WO-E46 Amendment 1** (day one must be calibrated by the assessment).

**Rebase onto merged E-43** (a separate pass): both v29 and v30 registered with nothing renumbered; a database **at v29 with live rows** proved to upgrade clean; `conversation-credit.ts` stopped carrying a copy of E-43's `metMinimumOnDay` SQL and now delegates (E-17, one reader for one fact). Because v29 then existed everywhere, `conversation` became a real server-verified step, so tests that used to finish a day by looping `markStepDone` no longer could — **they now credit a real conversation first, and no product behaviour was changed to make a test pass.**

**Accepted limitations:** a keyless machine's day reduces to one self-reported lesson step; **the completion beat renders two sentences where DESIGN.md §D-24 says one** → close sweep.

## E-45 — merged 2026-07-26 (PR #82, `26ad52b`) · repaired, then rebased

64 files, +4,094/−2,861 — **nearly as much deleted as added**, which is D-26 working. **1429 tests** at merge.

Deleted: the second lesson system, typed input, the billed rewrite-grading call, the `` `____ · ${category}` `` degradation and the duplicated category label. One lesson format, syllabus-first (D-27), sized by a stated content budget; drills accept **click or voice only**; a new STT biller enters the one ledger, reserving before calling.

**The review found two BLOCKING defects in the voice path — the exact risk flagged at planning time.**

1. **A mishearing wrote an unretractable negative.** STT returning a wrong transcript fired `onResolve("incorrect")` → cued evidence at `polarity: 0`. `evidence` carries `BEFORE UPDATE/DELETE RAISE(ABORT)` triggers, so **the row could never be removed** — a bad transcript of a *correct* answer permanently demoted a lemma the learner knows. The "That's not what I said" button rendered only **after** the write, and the on-screen copy said *"Nothing recorded either way."*
2. **The third-consecutive-mishearing fallback was dead code** — the event that should have advanced the counter reset it.

**The repair chose the right invariant and refused the easier one.** Offered "never write negative evidence from voice at all", the worker **declined**: that would make the microphone a strictly-positive channel, so identical performance would build a different knowledge model by input mode. Instead, ordering: resolving records nothing and only opens the dispute window; the write happens on leaving, by which time the transcript has been on screen and could have been rejected. The one case we cannot trust — the dispute — now writes nothing **in either direction**. All three lying copy strings made true.

**Then the rebase found the defect was still live where it mattered most.** `components/session/drills-step.tsx` — the surface the **daily flow** actually uses — still POSTed evidence the instant a drill resolved. The approved fix had landed only in the standalone runner. Declared as a cross-milestone change rather than made quietly, and accepted: shipping a blocked defect on the primary surface is not a trade worth making.

**And the owed guard came back better than demanded.** Mutation showed the repair's own new tests could not catch either defect — `lesson-runner-render.test.tsx` imports `DrillCard`, not the runner, so **D1 and D2 both survived all 1330 tests, and the commit subject claiming otherwise was false** (corrected in the merge record). Asked for a test reaching the runner, the worker declined to add jsdom *or* write another skirting test, arguing two dependencies covering two transitions would leave those transitions in a component — **the very shape that hid them**. It moved the sequence into `lib/lessons/drill-progress.ts`, a pure reducer that *returns* the effect rather than performing it; both drill surfaces dispatch to it and hold no rule of their own. D1 → 6 tests red, D2 → 5.

**Recorded known limitation:** no real accented human has spoken into a microphone. The seam is proven end to end with synthesised speech only — the residual risk on the feature named riskiest at planning.

### Lessons

- L: **A fix verified on one surface is not a fix.** E-45's B1 repair passed a delta re-review while the defect stayed live on the daily flow's own drill component; only a rebase surfaced it. → encoded as: when a repair touches a behaviour with more than one caller, **enumerate the callers before declaring it closed** — the "fix invariants, not instances" rule extended from code paths to *surfaces*.
- L: **An invariant held in React state is verified only by reading it.** Both E-45 defects and E-44's two lived there. The durable fix in each case was moving the rule into a pure module. → encoded as: `lib/lessons/drill-progress.ts` and `lib/session/` reducers; a standing preference for reducers that *return* effects over components that perform them.
- L: **A worker refusing the dispatcher's suggested fix, with an argument, is the process working.** Twice here — the voice-negative question and the jsdom question — the worker's answer was better than the brief's. → encoded as: D-26's product-authority clause, now validated on a correctness path as well as a design one.

---

## A cross-cutting lesson for mfactory — where this run's findings actually came from

Raised by the operator as a *"mild observation, and I might be totally wrong"*: that we over-focus on synthetic fixtures and under-focus on real use. It is worth more than that hedge, because this run's own ledger settles it.

**Counted by origin, not by impression.**

*Found by touching the real thing — 18:* `whisper-1` silently **correcting** the planted errors (`familia`→`famiglia`), which **overturned D-26's architecture before a line was written**; every `gpt-audio` model missing `"ho andato"` 9 times out of 9 with the answer in its own prompt; the Realtime cost argument running backwards from what was assumed; the TTS rate being wrong in *shape*, not value; `call_id` discarded so the tutor's correction was **never spoken** on 5 of 9 fixtures; **every** tutor conversation refused `422 undecodable_audio` for two versions; the tutor narrating its own bookkeeping aloud; the drills step completing itself at zero planned cards; the day never recorded when the last step completed by observation; an item lesson that **resolves, bills and returns nothing**; the model replying in **prose instead of JSON** on a silent clip; a routing gate **walked past by client-side navigation** (`RSC: 1` → 200 and the page); the tutor reporting a permanently revoked key as *"just now"*; a failed ingest unrecoverable behind raw `ffprobe` stderr; the tutor at the cap with zero controls; B1 still live on the daily flow's own drill component after its repair was approved; `npm run lint` a **no-op in every nested worktree**; and the repo's own cold-start test making a **live billed API call** from a configured machine.

*Found by the test suite — 4:* a vacuous migration-backfill test; dead `isAssumedRunLeaseHash`; two mutants surviving the whole suite; an under-booked rate (caught by arithmetic, then **confirmed by live measurement** that also corrected the reviewer's own prescription).

**The pattern is the finding: all four test-originated items are defects in the TESTS, not in the product.** Mutation testing kept discovering that the tests were wrong. Meanwhile **1,429 green tests coexisted with the flagship milestone lying to users about a permanent failure**, and 1,012 green tests coexisted with v0.6's cold-start failure before that.

**So:** *tests verify what you thought of; driving finds what you didn't; mutation testing verifies the tests, not the product.* The error is treating a green suite as evidence **about the product**.

**What is actually new here.** The repo already half-knows this — D-13 ("fixtures prove mechanism, never judgment") and `HANDOVER.md` ("reading finds wrong logic; driving finds features that do not exist"). What this run adds is that we apply it **last and ceremonially**, as a close gate, when the evidence says it should come **first and cheap**. The economics are not close: total live spend for the entire version was **≈ $2.20**, of which a **$0.74** spike reversed a major architecture decision and a **$0.003** one exposed a mispriced rate. Three separate milestones had their most important defect found by a single live call each.

**Proposal for `factory-retro.md`, advisory only:**
1. **First contact before first commit.** Where a milestone touches an external system, the *first* verification is one real call — not a fixture, not a mock — and its result is written into the work order before the build proceeds. Two architecture decisions this version would have been wrong without it.
2. **A green suite is not a claim about the product.** Exit reports should state findings by *origin* (driven / live / test / read), so a milestone verified only by tests is visibly a milestone not yet verified.
3. **Keep mutation testing, and re-aim it.** It earned its place — but as a check on *tests*, which is what it actually measures. Do not let it stand in for touching the product.
4. **Budget live verification like a gate, not like a luxury.** $2.20 bought more truth this version than any amount of fixture work, and the fixtures that mattered (D-13's labelled samples) were the ones standing in for reality, not simulating it.

Filed here rather than in mfactory's `runs/` because no mfactory checkout is reachable from this machine; it syncs with the rest of RUN-007.

**Two counterpoints, so this does not become a worse doctrine than the one it replaces.**

**1 · Counting findings structurally underweights tests, because prevention is invisible.** A test that stops a defect from ever being written produces no ledger entry. The 1,429 tests in this version are mostly *not* there to find things — they are there so that the next change does not silently break the tutor's money spine, the `known` gate, or the append-only evidence log. This run has no way to count what they held still while five milestones rewrote the product around them, and that number is not zero. The honest claim is narrower than "tests did not find much": **tests are weak at discovery and strong at conservation, and we have been paying for discovery with the wrong instrument.**

**2 · Reading did find the money defects, and reading is not driving.** The under-booked rate, the stale-lease partial sweep, and the dead `isAssumedRunLeaseHash` came from a reviewer reading code carefully — then *live measurement corrected the reviewer's own prescription* (700 tok/min would have under-booked; the real figure was 20.0 tok/s). So the sequence that worked was **read to form a hypothesis, then measure to settle it.** Neither half alone would have got there: reading produced a wrong number confidently, and measurement without the reading would not have known to look.

**So the refined rule is not "test less".** It is: **discovery comes from contact with the real system; conservation comes from tests; and a claim about the product is only as good as the last time someone touched the product.** The specific waste this run exhibits is not that tests exist — it is that *driving* was scheduled as a **gate at the end** rather than as the **first verification of each milestone**, so three milestones each shipped a defect that one live call would have exposed on day one.

---

## Final lessons for mfactory — RUN-007

Ratified by the operator at the version's close. Ordered by leverage, not by when they were learned.

### 1 · The most valuable finding class is "a feature that never worked at all" — and only using the product finds it

The three biggest defects this version were not wrong logic. They were **features that did not exist**:

- **Every tutor conversation had been refused `422 undecodable_audio` for two versions.** E-34's own acceptance criterion — *"the call records client-side and lands as a normal session → ingest → deep analysis"* — was marked `done` and was **false from the day it shipped**.
- **The tutor's corrections were never spoken.** `call_id` was discarded, so on any turn it had something to teach, it fell silent after a holding line.
- **The onboarding gate was never enforced**, because client-side navigation walks past a root-layout check.

A test cannot find these. A test exercises what you built; these were never built. A review cannot find them either — three independent Full reviews read E-37's branch in v0.6 and missed a page unreachable on every route. **Only meeting the product the way a user does finds a thing that isn't there.**

**Encode:** an acceptance criterion that asserts an **end-to-end outcome** must be verified end to end, once, by observation — never by a unit test of a helper on the path. If nobody watched the outcome happen, the criterion is unproven regardless of the suite.

### 2 · Make driving cheap, maintained and standard — the single highest-leverage change

Every worker and reviewer this run **rebuilt the driving apparatus by hand**: `npm ci`, build, choose an unusual port, start a server, prove the responder, seed a disposable database. Ten-plus times, ~15 minutes and real tokens each, *before any finding*. The proofs were consequently uneven — some asserted the responder in both directions, some in one, one agent had no browser tool in its worktree at all and fell back to HTTP.

Meanwhile **12 Playwright specs sit in `e2e/` that CI has never run** — owed since v0.6, and the direct reason an unreachable page shipped.

**Encode:** a committed, maintained harness — one command that builds, binds a random port, **proves the responder in both directions**, seeds a throwaway database and returns a URL — plus wiring the existing e2e specs into CI. The point is not only cost. A hand-rolled apparatus is a *different* apparatus every time, so its guarantee varies; a maintained one makes the responder proof automatic and uniform. **When driving is cheaper than writing a test, the incentive flips without any new process.** (Operator: *"make it cheap and better because it is maintained, more robust, and not created from scratch every time."*)

### 3 · Tests are conservation, not discovery — budget them that way

18 findings came from contact with the real system; 4 from the suite, and **all four were defects in the tests**. 1,429 green tests coexisted with the flagship milestone lying to users about a permanent failure; 1,012 did the same through v0.6's cold-start failure. Yet the count *underweights* tests: a test that prevents a defect from ever being written leaves no ledger entry, and these tests held the money spine, the `known` gate and the append-only evidence log still while five milestones rewrote the product around them.

**Encode:** stop treating test count as a version signal — v0.6 was, in its own words, *the best-tested and least usable* version of this project. Require **mutation proofs where a guard protects money, data loss, or a stated invariant**, not everywhere. And state findings by **origin** (driven / live / read / test) in every exit report, so a milestone verified only by tests is visibly a milestone not yet verified.

### 4 · Read to form the hypothesis; measure to settle it

The money defects came from a reviewer reading carefully — and then **live measurement corrected the reviewer's own prescription**: it prescribed 700 tokens/minute, the real figure was 20.0 tok/s, and the prescription would have *under-booked* the cap. Reading alone produced a confident wrong number; measuring without the reading would not have known where to look.

**Encode:** where a milestone touches an external system, the **first** verification is one real call — not a fixture, not a mock — and its result goes into the work order before the build proceeds. Two architecture decisions this version would have been wrong without it. Total live spend for the whole version: **≈ $2.20**, of which **$0.74** reversed a major architecture call and **$0.003** exposed a mispriced rate.

### 5 · State intent and grant authority; do not enumerate criteria

The work orders were long and criterion-dense, and the best outcomes came from workers **overriding** them: the voice-negative invariant (the worker's answer was better than the dispatcher's), the jsdom question (it refused to add a dependency that would have left the invariant in a component), the rate override (live data beat the reviewer's prescription). Each time the criterion was the weaker artefact.

Conversely, criterion-satisfaction produced the worst outcome available: E-46 satisfied *"an empty database forces onboarding"* while leaving the home's one action pointing at a route the same PR deleted.

**Encode:** the operator's product-authority clause (D-26) is the load-bearing part of a work order, not a footer. Lead with the **intent and the bar** — *a person who has never seen this repository can use the thing without asking a question* — grant explicit authority to contradict any criterion with a written argument, and keep criteria few and behavioural. A long criteria list invites satisfying the list.

### 6 · The operator's own use is the highest-signal input in the system

Two of this version's largest course corrections came from the operator using the product for minutes: *"the realtime API listens very well but does not speak super well"* → the whole E-43 arc; and *"for listening… I think realtime might be good"* → which **caught a flaw in D-26 that would have made the tutor detect mistakes from a transcript, exactly what D-3 forbids**, before a line was written. No agent, review or test raised either.

**Encode:** put the operator in front of the product at the *earliest* buildable point, not at the close. Ship them something runnable mid-version and ask for a reaction, not approval.

### 7 · Cuts to make (ratified)

- **Review tiers were declared and then ignored** — all five milestones ran Full. Use the tier; Light exists for additive UI over an existing read-model.
- **~12 docs PRs, each burning a full CI cycle.** Batch the ritual and the record into one PR per milestone, or one per version.
- **Reviewers re-ran the whole gate suite CI had already run.** Review the diff and drive the product; trust CI for the gates.
- **The 500-line hook fired twice mid-run** and produced good seams both times — keep it.

### 8 · Dispatcher failure modes, recorded against myself

- **A rescope message was misaddressed** to the E-44 worker instead of the E-43 money reviewer; it cost real time and the worker had to be told to disregard it. **Name the recipient's milestone in the first line of every agent message.**
- **A rescue ran `git add -A` inside a live agent's worktree**, leaving it a staged index it had not created. **Capture patches to scratch; never stage another agent's tree.**
- **~16 agent deaths** (network, one spend limit, the rest stream-watchdog stalls on long turns) cost **nothing durable**, because of three habits worth keeping: push after every *file* rather than every milestone; write review verdicts to disk incrementally; and rescue a worktree before relaunching. **The lost-signal backstop and the "probe before declaring an agent dead" rule both earned their place again.**

---

## E-46 — merged 2026-07-26 (PR #85, `1cc1119`) · repaired · **the version's weakest proof, stated plainly**

66 files, +2,632/−421. **1371 tests.** Worker ≈$0.018, reviewer $0.00.

An empty database now **forces** onboarding and cannot be walked past; `/welcome` states what Erika needs (key, automatic analysis, the cap, the worker) with the key **observed rather than asserted**; the vocabulary check is byte-unchanged; one or two spoken prompts infer level from real production and double as the D-22 enrollment take (never uploaded); onboarding ends **inside** the first session. `/progress` replaces `/dev/knowledge`. Deleted: the dev inspector and its API, `lib/knowledge/inspector.ts`, `app/practice/placement`, the dismissible placement prompt, and the learn-the-requirements-from-an-error-string path.

**Amendment 1 delivered — day one is calibrated.** Driven live from an empty database with speech declined: the vocabulary check alone placed **C2** and the first session rendered **"C2 · Aspect in compound and progressive forms"**. Tests assert the *positive* three ways (B1→B1 rule, re-place B2→B2, declined→B1), which is the shape that matters because "no A1 rule" is satisfied by no lesson at all.

**The finding worth keeping: a routing gate in the root layout is bypassed by client-side navigation.** `curl -H "RSC: 1" /practice` returned **200 and the practice page** — the App Router caches the root layout, so the gate never ran. Moving every page under `app/(app)/` fixed it; the same request now returns `NEXT_REDIRECT;replace;/welcome;307`. **Forced onboarding was not forced for anyone already inside the app.**

**A live call earned its keep for the third time this version.** A clip containing no speech made the model reply in **prose, not JSON**; the strict-JSON repair now exists and a test pins the shape. The worker's own note: *a mock would not have found it.*

**The review's blocking finding, and why it matters beyond itself.** `homeAction` still returned `href: "/practice/placement"` — a route **this same PR deleted**. Live 404. The people who hit it were not hypothetical: a check refused as `response-style` records no run and seeds nothing *by design*, while onboarding writes the completion marker **unconditionally**, so the learner arrives onboarded-and-unplaced — **exactly the yes-biased advanced learner criterion 3 exists to rescue** — and meets a one-action screen whose one action 404s. Two tests pinned the dead href **as specification** (D-14). The repair fixed the class: `tests/session-steps.test.ts` now enumerates every state, collects every href the action *actually returns*, and resolves each to a `page.tsx` on disk, so the next deleted route is a red test rather than a live 404.

**⚠ The delta re-review never completed.** Two attempts died to platform failures (a 529 and a watchdog stall), producing no verdict. Rather than spend a third, the dispatcher verified the repair **by reading**. **This is the weakest proof in v0.7 and is recorded as such**, because this version's own lesson is that reading finds wrong logic while driving finds things that are not there. Mitigation, partial and stated: gates green at 1371, the guard is structural rather than a string assertion, and **the cold-start walk drives onboarding as its first step** — which is where a residual defect here would surface.

**Accepted limitations:** the profile disjunction omits `day_ledger`/`daily_sessions`, so a pre-E-46 Learn-only learner takes a one-time forced detour through onboarding (recoverable) → close sweep. The E-44 one-action test now exempts the whole goal section rather than bounding it, so nothing stops that section growing to three affordances → close sweep. Microphone paths driven only as far as "Skip" (`getUserMedia` cannot run headless); the record→judge round trip proved by posting a file; the B2 verdict came from synthetic TTS, so it validates the contract, not the band's calibration.
