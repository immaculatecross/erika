# WO-E44 — One session a day

Target repo: github.com/immaculatecross/erika · Branch: `feat/e44-one-session-a-day` · **Review tier: Full**
Batch: **solo, serial.** Depends on WO-E43 (merged): you consume its `tutor_conversations` contract. You own **migration v30**. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-44), `DECISIONS.md` (**D-26**, and **D-24 is binding line by line**; also D-17, D-18, D-23), `HANDOVER.md`, `CLAUDE.md`, **`DESIGN.md` §"The daily ritual (Learn)"**, then `.mfactory/playbooks/task.md`.

## Objective

The Learn home currently renders seven sections and up to thirteen actionable rows across four to six separate pages, and the operator's reaction is the whole reason this version exists: *"a good consumer product like Duolingo would have just one session per day, very clear, no questions asked, super polished, super straightforward."*

Underneath the clutter is a mechanical dishonesty that explains the feeling. `lib/day-ledger.ts` computes the day's goal from **cards alone**, and `recordDayComplete` writes `lessonsDone: 0` as a hard-coded literal. So a learner can read a lesson and hold a ten-minute Italian conversation and the day counts for **nothing**. Everything the plan offers is, mechanically, optional — which is exactly how it reads.

When this is done: one screen, one action, one linear session, and a day that is complete when the learner has actually done the day's work.

## Acceptance criteria

1. **One screen, one action.** The Learn home shows the goal ring, the streak line (with D-24's repair disclosure intact), and exactly **one** primary control — *Start today* / *Continue* / the completion sentence when done — plus one factual line describing what today holds ("A lesson on the congiuntivo, 12 cards, and a conversation"). Nothing else in the main column is tappable. A Library entry and the Settings gear are chrome, not plan items. Assert the count of interactive elements in a rendered-DOM test.
2. **A linear, resumable session.** One route runs lesson → drills → conversation → done. The learner chooses nothing to progress. Closing the tab and returning resumes at the step they left (migration **v30**, documented in `docs/schema.md` in the same PR — `tests/migrations.test.ts` enforces it). v30 is the next free number after E-43's v29; never renumber.
3. **No step can end at a wall.** This is the milestone's hardest criterion and the one RETRO-004 named thirteen times. Enumerate, in the PR body, **every** failure mode of **every** step — no API key, budget cap reached, a transient model failure, an empty corpus with nothing yet to teach, a denied microphone, a worker that is not running — and for each state what the learner sees and what their way forward is. Then test them. Rules: a **permanent** condition is never described as *"right now"* or *"just now"*; every refusal carries a working control (a retry that retries, a link that links — today "raise the cap in Settings" links nowhere); and a step that genuinely cannot run **degrades to something real** rather than blocking the session. The keyless-ingest notice from commit `7a30878` is the standard to match.
4. **The day is complete when the session is.** Replace the cards-only goal and delete the `lessonsDone: 0` hard-code. The conversation step counts only when E-43's `tutor_conversations` says the **minimum duration** was met — that is the operator's rule: *"only when this duration is hit, then this will validate the streak."* **Recorded history is never rewritten**: days already in `day_ledger` keep their recorded status, the new rule applies from the day it ships, and every existing `lib/streak/` test still passes unchanged. Say in the PR body what a learner who is mid-run on the old rule experiences on the day this lands.
5. **The letter earns its way into the flow.** Once a week the editor's letter appears as a **step inside the session** — the operator's own suggestion for a demoted surface that deserves a place — and stops being a row on the home. Unread state and the E-24 `POST /api/letter/viewed` contract are unchanged.
6. **One Library entry holds everything else.** Focus, phrasebook, archive, slips, readings, listen-and-shadow, the pronunciation studio, the pattern-lesson list and the card browser all move behind a single quiet entry. **Nothing is deleted and every existing deep link still resolves** — extend E-30's route→tab and redirect test to cover the new arrangement. D-17's "existing surfaces demote to secondary, nothing is deleted" is the standing rule; D-26 only tightens where they live.
7. **D-24 is unchanged and must be re-proved.** One ring, accent ink on a hairline track, closed with the standard spring. **One** factual completion sentence, once per day — introducing a session concept must not introduce a second celebratory beat. Streak is a number and a word, sentence case, repairs named while there are one or two and counted once there are more. Banned, still: confetti, mascots, XP, points, levels, leaderboards, badges, purchasable anything, guilt copy on a broken streak. A run of zero renders nothing at all.
8. **Two standing lies on this surface go.** `Said N×` counts a **button press**, not a completed loop, and that visit row permanently retires the correction while playback failure is swallowed — make the count mean what it says and make failure visible. And *"N sounds at your edge… they come back through the lines below"* promises a return **no code path implements** (`lib/compose.ts` documents the opposite), rendered directly above "No pronunciation drills yet." — make it true or remove it.
9. **The composer keeps composing.** `lib/compose.ts` stays pure, unit-tested and model-call-free; it now feeds one session instead of a list of rows. Its `slip` and `finding` plan items — which today have no row at all and only feed counts — must either reach the learner inside the session or be removed. A plan item that nothing renders is a concept with no product.

## What this milestone deletes

Your PR body carries a **"What this deletes"** section. Expected: the seven-section Learn home, thirteen dead-end row types, four to six separate destinations as *primary* routes, the cards-only day goal and its `lessonsDone: 0` literal, and every "unavailable right now" wall. If concepts go up on net, justify it.

## Files and constraints

Centre of gravity: `app/practice/page.tsx`, a new session runner route, `lib/today.ts`, `lib/compose.ts`, `lib/day-ledger.ts`, `lib/learn-items.ts`, `lib/nav.ts`, `components/goal-ring.tsx`, `components/streak-line.tsx`, `components/today-thread.tsx`, `app/api/learn/today/route.ts`, `app/api/day/complete/route.ts`, `lib/migrations/v30-daily-sessions.ts`, `docs/schema.md`.

Must not break: `lib/streak/` and the `day_ledger` local-day keys (E-31/E-38); `lib/findings-model.ts` as the one findings gate; append-only `evidence`; reserve-before-call and the hard cap; D-18 correction-forward; D-23 register composition. DESIGN.md binding throughout — springs not durations, transform/opacity only, `prefers-reduced-motion` degrades to fades, one signature moment per surface, copy quiet and exact.

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file, never edit a shipped migration, never commit `data/` or `.env*`, disposable database only.

## Out of scope

Lesson content and card fronts (WO-E45 — you build the container, it fills it); onboarding and the progress surface (WO-E46); the Record tab (WO-E42, merged); the tutor's internals (WO-E43, merged — you consume `tutor_conversations` and nothing else); `FEATURES.md`/`STATE.md`.

## Verification

Drive the built app on a fresh disposable database — keyless, keyed, and at the budget cap — and walk the session to completion in a browser. **Prove which server answered you** (unusual port, assert a string unique to your build) and state the proof. Mutation-prove every new guard: break it, show red, restore, quote the output. Before writing criterion 3, state the invariant — *every step either completes or offers a real way forward* — and enumerate every path that could violate it; then ask what the opposite failure looks like (a step that claims success it did not achieve). Five v0.6 repairs created their own mirror image; this criterion is where that happens if it happens.

Gates green plus tripwires. **Branch and push first**: empty commit and `git push -u origin feat/e44-one-session-a-day` as your very first action.

## Exit report

Append here and **write it before returning**. Include the criterion-by-criterion status, the "What this deletes" list, the **full failure-mode enumeration from criterion 3** (this is the artifact the version's failure-path gate will be judged against), the mutation proofs, the proof of which server answered, and what a mid-run learner experiences the day the goal rule changes.

---

```
RESULT: done
PR:     feat/e44-one-session-a-day
```

### Criterion by criterion

| # | Criterion | Status |
|---|---|---|
| 1 | One screen, one action | **met** — `components/learn-today.tsx` is pure and prop-driven; `tests/learn-today-render.test.tsx` counts interactive elements in the rendered markup: **1** before the session, **1** during, **0** once the day is done. Verified in a browser on four databases. |
| 2 | A linear, resumable session | **met** — `/practice/session` runs lesson → drills → letter → conversation → done. The resume point is a durable fact (migration **v30** `daily_sessions`), never client state. |
| 3 | No step ends at a wall | **met** — full enumeration below; five of six modes rendered in a browser. |
| 4 | The day is complete when the session is | **met** — the cards-only goal and the `lessonsDone: 0` literal are gone. The conversation counts only when `tutor_conversations.met_minimum` says so. |
| 5 | The letter earns its way into the flow | **met** — a step inside the session when unread, gone from the home. `POST /api/letter/viewed` and the unread marker are untouched. |
| 6 | One Library entry | **met** — `/library` holds all eleven demoted surfaces; the whole section sub-nav is deleted. Every href resolves (asserted against `app/` on disk *and* driven in a browser: 12/12, zero broken). |
| 7 | D-24 unchanged, re-proved | **met** — one ring, one factual sentence, streak repair disclosure intact, ban list asserted in the render test. |
| 8 | Two standing lies go | **met** — `Said N×` now counts a completed playback (fires on `ended`), and playback failure is visible; the "they come back through the lines below" promise is removed. |
| 9 | The composer keeps composing | **met** — `lib/compose.ts` still pure and model-call-free. `finding` items reach the learner as cards in the drills step; the `slip` plan item is **removed** (argued below). |
| 10 | A recording-less day is a complete day | **met** — the primary path, driven first, on a database with **zero sessions, zero findings, zero cards**. |
| 11 | The differentiator is still visible | **answered honestly below — and the honest answer is "barely, on day one"**. |

### What this deletes

- **The seven-section Learn home** → one card, one line, one control.
- **Thirteen actionable rows** → zero. The review, tutor, lesson, new-items, sounds and letter rows, the map strip and five secondary links are gone; the render test asserts each `data-*` hook is absent.
- **The entire section sub-navigation layer** (`sectionFor`, `isSectionActive`, `RECORD_SECTION`, `LEARN_SECTION`, `SectionNav`) — a whole navigation tier, replaced by one Library icon.
- **Four to six destinations as primary routes** → one session route.
- **The cards-only day goal** and **`recordDayComplete(..., { lessonsDone: 0 })`**.
- **Every "unavailable right now" wall on this surface** — a step that cannot run is now absent with a stated reason, not a row that refuses.
- **The `slip` plan item** in `lib/compose.ts`.
- **The duplicated letter rendering** — `/letter` and the session step share `components/letter-body.tsx`.
- **The "N sounds at your edge… they come back through the lines below" promise.**

Net concept count is down. Added: the session and its four step kinds (one concept replacing thirteen rows), the Library entry, one migration.

### Criterion 3 — the full failure-mode enumeration

**The invariant, stated before the fix:** *every step either completes or offers a real way forward.* The structural answer is that **a step Erika cannot deliver is not in the session at all** — never a row that refuses, because a row that refuses is a wall with a coat of paint. `planSession` decides this server-side; the UI cannot invent a step.

**The opposite failure — a step that claims success it did not achieve — is guarded separately, and it bit me during the build.** `verifyStep` for drills read `cardsReviewedToday >= plannedCards`, which is **trivially true when the session planned zero cards** — the recording-less day. Reading that as "done" auto-completed the drills step and, with only a lesson beside it, the whole **day**, the instant the learner pressed Start. `observeStep` (a fact in its own right → may complete a step) is now separated from `verifyStep` (a gate on a client claim → may only refuse).

| Step | Failure mode | What the learner sees | Their way forward |
|---|---|---|---|
| Lesson | **No API key** | The rule's real lesson — E-26's authored title, description and correct examples — plus *"Erika writes exercises and speaks with you through the OpenAI API, and no API key is set on this machine. Settings says where to put one."* | A working `/settings` link. The lesson completes normally; the day is not blocked. **Verified in a browser.** |
| Lesson | **Key rejected (401/403)** | Same lesson, plus *"The API key on this machine was refused by OpenAI. It may have been rotated or revoked."* | `/settings` **and** a retry. Deliberately distinct from "no key" — telling someone who configured a key that none is set sends them to check something already correct. |
| Lesson | **Budget cap reached** | Same lesson, plus *"The monthly budget is spent. It frees up when the month rolls over, or raise the cap in Settings."* | A working `/settings` link. **Verified in a browser.** |
| Lesson | **Transient model failure** | Same lesson, plus *"Erika could not reach the lesson model just now."* | A retry that **re-runs the call**. **Verified live** — a real `gpt-4.1-mini` reply failed to parse and this is exactly what rendered. |
| Lesson | **Another tab is generating it** | *"Erika is still writing this lesson."* + retry. | Previously a `202` the client read as success before crashing on the missing body. |
| Lesson | **Nothing left to teach** | The step is absent; the home says *"Nothing left to teach you today."* | Reviews still return on schedule; stated, not promised. |
| Drills | **No cards and no exercises** | The step is **absent**; the home's sentence never mentions a drill. | Nothing to do, and nothing pretends otherwise. |
| Drills | **Nothing due (cards exist elsewhere)** | *"No cards are due today. Cards come from your own recordings and return on their own schedule."* + Continue. | The session continues. |
| Drills | **A grade fails to save** | *"That answer could not be saved just now — nothing was lost, and it can be sent again."* | A retry that **re-sends the same grade**. The old review screen swallowed this and advanced anyway, losing the review silently. |
| Letter | **The letter cannot be read** | *"Your letter could not be read. It will be waiting next time — nothing is lost."* + Continue. | The session continues; completion is verified against the viewed marker, so a letter that failed to record as read leaves the step open rather than silently completing the day. |
| Conversation | **This build cannot record one** (E-43's v29 absent) | The step is **absent**. | The tutor is still in the Library. A step whose completion could never be observed would be a control that does nothing. |
| Conversation | **No key / cap reached** | The step is **absent**, reason recorded. | `/settings`. |
| Conversation | **Denied microphone** | *"Your browser is blocking the microphone, so Erika cannot hear you. Allow microphone access for this site in your browser's address-bar permissions, then reload."* The "Start talking" link is **withheld** — it would lead to a page that cannot work. | The exact browser setting is named (the remedy is outside the app, so this is the one notice whose way forward is an instruction rather than a link), plus a re-check control. **Verified in a browser.** |
| Conversation | **Fell short of the minimum** | The step stays open. No countdown, no warning, no guilt copy (D-24). | The same door. |
| Any | **Worker not running** | **Nothing in the session depends on the worker.** The session makes no ingest or analysis call; the worker only affects whether *new* findings (and so new cards) arrive. | The drills step simply has exercises and no new cards. Stated rather than discovered. |
| Home | **`/api/learn/today` fails** | *"Today's session could not be read just now."* + a retry. | The old page substituted a zeroed view, rendering an outage as the confident, false *"Nothing to practice right now."* |

**The copy rules are enforced by tests, not by prose** (`tests/session-notices.test.ts`, 15 assertions): a *standing* condition may never contain "right now"/"just now" (only `model-transient` and `save-failed` may, and both are non-standing); any notice mentioning Settings must carry a `/settings` link that **resolves to a real page on disk**; a retry is offered only where retrying can change the outcome.

### Criterion 11 — what is specific to this learner on a recording-less day

Honestly: **less than the pitch implies, and on the very first day, almost nothing.**

What genuinely personalises a recording-less day:

- **Which syllabus rule they are shown.** The composer walks E-26's prerequisite DAG from the learner's own knowledge state. Observed live: day one taught `alfabeto-suoni`; after its exercises wrote cued evidence, the next session taught `accento-grafico`. That progression is theirs.
- **Their placement level.** Placement seeds sub-level rules as `introduced`, and `TEACH_ELIGIBLE_PREREQ` consumes that, so a B1-placed learner is offered different rules from an A1 one.
- **Their due reviews**, when cards exist from earlier recordings — FSRS-ordered, worst retrievability first.
- **The tutor's targets**, drawn from that same plan.
- The register dial — a setting, not learner-derived, so it barely counts.

**But on day one, with no recordings and no placement, the session is generic**: rule #1 of the syllabus at A1, no cards, a conversation primed with an empty profile. Nothing distinguishes it from what any other new user would get. The differentiator does not switch on until the learner takes placement or records something. That is a real finding, and it is E-46's to close — precisely why "onboarding is mandatory on an empty database" is a v0.7 milestone.

### Product calls

1. **The lesson step always prefers a grammar rule.** A rule is the only item kind carrying real teachable content with **no model call at all** — E-26 authored a title, description and correct examples for all 266. The lexicon is frequency data with no glosses (D-19 keeps the CC BY-NC glossaries out of the shipped data path), so a lemma lesson cannot degrade to anything. Preferring the rule is what makes the lesson step structurally incapable of ending at a wall. Rejected: teaching whichever item the composer's interleave put first, which would leave the keyless lesson blank.
2. **A step that cannot run is absent, not disabled.** Rejected: a disabled row with an explanation — that is thirteen "unavailable right now" rows with better copy, and the operator's complaint was concept count.
3. **The conversation step is omitted where it cannot be credited.** Without E-43's v29 there is no way to observe whether a conversation happened; offering it would be a control that does nothing. **Consequence, stated plainly: until E-43 merges, the shipped session is lesson → drills → done.**
4. **An unplaced learner's one control is "Find your level", not "Start today".** On a fresh install the three-minute check is the right first action, and making it *the* action keeps the screen at one control instead of adding a second row. E-46 turns this into a hard gate.
5. **The `slip` plan item is removed** (criterion 9 explicitly permits removal). A slip is a *cluster of findings*; its occurrences are already `finding` items, which mint the cards the drills step serves — the same mistake was consuming two `dailyMax` slots and rendering nothing. Slips are untouched where they live: the dossier, the map's semantics, the tutor's targets.
6. **Today's thread renders only alongside the completion sentence.** D-24 allows the completion moment to cite one positive production event; rendering it earlier would be a fifth element on a screen criterion 1 caps at four.
7. **The knowledge map moved to `/focus`** rather than being left unrendered — a component with tests and no consumer is exactly the "concept with no product" criterion 9 condemns.
8. **The plan is frozen at open.** Every input the planner reads moves while the learner works; a session recomputed on each read would grow and shrink under them, and the home's sentence would be a lie by the time they finished.

### Mutation proofs

Each mutation applied to the source, suite run, mutation reverted.

1. **`reconcileSession` folds in merely-ungated steps** (`observeStep` → `verifyStep`): the drills step auto-completes on a recording-less day. → `tests/session-day.test.ts` *"counts steps, and is not met until every one is done"* fails with `expected 1 to be +0`; `tests/session-store.test.ts` *"returns to the first step not yet done"* fails with `expected null to be 'drills'`. **A live bug caught by the test, not a synthetic mutation.**
2. **`completeDayIfMet` removed from `buildSessionView`**: `tests/session-day.test.ts` *"records it when the LAST step completes by observation"* fails — `getDayCompletion` is null. **Also a live bug, found by driving the built server.**
3. **`lessonsDone: 0` restored** in `completeDayIfMet`: *"records real figures — the lessonsDone: 0 literal is gone"* fails (`expected 0 to be 1`).
4. **Conversation verification made unconditional**: *"leaves the step open while the conversation fell short"* fails — a below-minimum conversation credits the day.
5. **"right now" reinserted** into the `no-key` notice: *"no-key states a permanent condition permanently"* fails.
6. **The `/settings` link removed** from the budget notice: *"a notice that MENTIONS Settings also LINKS to Settings"* fails.
7. **A second link added** to `components/learn-today.tsx`: *"offers one control before the session is started"* fails (`expected 2 to be 1`).

### Proof of which server answered

Every walkthrough bound an **unusual port** (39447 / 39448 / 39449 / 39451, never 3000) and asserted, in **both directions**, that the responder was this build:

- present: `data-primary-action`, `data-library-entry` — exist **only on this branch**;
- absent: `data-today-cards`, `data-section-nav` — exist **only on master**.

The script exits non-zero if any of the four fails. `.next/BUILD_ID` was read from disk and reported with each run: **`E5YkksjBmJWJfUv-EQM1h`** before the day-ledger fix, **`IN4BibBa9Aa_kke8TeyDY`** after the rebuild — the change of build id is itself proof the post-fix runs did not hit a stale server.

Databases were disposable throughout (`ERIKA_DATA_DIR`/`ERIKA_DB_PATH` under the session scratchpad). `data/erika.db` was never opened.

### What a mid-run learner experiences the day this ships

Their streak is **untouched** — `lib/streak/` reads only `day_ledger.local_day`, no past row is recomputed, and every existing streak test passes unchanged.

What changes is **today**. Yesterday, clearing the card queue completed the day. Today the home says *"A lesson on the congiuntivo, 12 cards, and a conversation"* and the ring counts **steps**, so clearing the cards alone leaves the ring at 1 of 3 and the day open. If they stop there, the day is missed. Their run is then protected by D-24's two silent monthly repairs if a credit is available; if not, the run simply ends — no prompt, no warning, no guilt copy, exactly as D-24 requires.

That is the honest cost of the change, and it is the point: a day that counted a lesson and a ten-minute Italian conversation for nothing is what made everything feel optional.

### Verification

- **Gates**: `npx tsc --noEmit` clean · `npx vitest run` **1217 passed, 141 files** · `npm run build` exit 0 · `.mfactory/hooks/run-tripwires.sh --all` exit 0.
- **Lint**: `npm run lint` is a **no-op inside a nested worktree** (Next resolves config against the parent checkout and lints nothing). Real signal via `npx eslint app lib components tests e2e scripts --ext .ts,.tsx`: **0 errors, 13 warnings, all pre-existing on master** (verified by diffing against `origin/master`). A bare `npx eslint .` additionally trips on the generated, gitignored `next-env.d.ts`, which is not in the CI lint set.
- **Browser walkthroughs** on four disposable databases: cold/unplaced, keyless, cap-reached, and the full three-step session. Zero page errors and zero console errors in every run. All 12 Library destinations resolved.

### Live spend

**$0.0024** total — two `gpt-4.1-mini` item-lesson calls ($0.0013592 + $0.001082), against a $0.40 allowance. Both are committed rows in the disposable databases' `spend_ledger`. The key was read from `.env.local` at process start and never printed, logged or committed.

### Findings handed on, not fixed here

1. **E-45 — item-lesson generation truncates against a live model.** Driving the built server with a real key produced a call that **resolved, billed $0.00136, and failed to parse**: `ITEM_LESSON_MAX_OUTPUT_TOKENS = 1400` is not enough for the prompt's own 3–5-exercise contract on longer rules, so the reply is cut mid-JSON. The money spine behaved perfectly (billed-but-unreadable still ledgers; the claim is released so a retry can re-lease) and E-44's degradation absorbed it — but **a learner pays and gets no lesson**. First time this path has run against a live API. E-45 owns lesson generation.
2. **E-46 — day-one personalisation.** See criterion 11.
3. **`docs/schema.md` says "Latest version: v30"** while v29 is E-43's and absent here. The migration list is a set, not a range, and the runner sorts by version — but that doc line will conflict when E-43 merges. Trivial rebase resolution.

### Tests changed or removed

- `tests/day-ledger.test.ts` — the `dayGoal` block and the `completeDayIfMet` case were **moved**, not deleted: what completes a day is no longer this module's question. They live in `tests/session-day.test.ts`, expanded.
- `tests/today.test.ts` — rewritten for the new `TodayView` (steps and one action, not rows and counts).
- `tests/two-tab-shell.test.ts` — section-sub-nav assertions replaced by Library assertions, per the work order's instruction to extend E-30's route→tab and redirect test. The route→tab matrix and the redirect contract are **unchanged and still asserted**, with new routes added.
- `tests/compose.test.ts` — the `slip` candidate removed from the fixture and the ordering assertion, plus a positive assertion that no plan item is a slip.

No test was weakened to pass.

### Risks

- The conversation step is unexercised end to end until E-43 merges: its contract is proven against a hand-created v29 table (the exact DDL), and the browser walk stops at "Start talking". **Rebase onto merged E-43 before merge.**
- `daily_sessions.steps` is JSON in a text column; a corrupt row degrades to "no steps" (tested) rather than throwing.
- The lesson step's completion is self-reported. Reading an explanation leaves no durable trace, and demanding the exercises' evidence would make the keyless lesson uncompletable — a gate firing precisely when the learner did nothing wrong.

---

## Standing clause — product authority (operator directive, 2026-07-25)

Operator, on approving the v0.7 plan: *"aim for a really complete, usable, intuitive consumer product. Each one of those can have solutions — really make product calls, after thinking well and justifying them a little bit."*

**So the bar is not "the acceptance criteria are satisfied." The bar is that a person who has never seen this repository can use the thing end to end, without asking a question, and want to come back tomorrow.** If a criterion is ticked and that sentence is still false, the milestone is not done.

**You have product authority inside this milestone's scope, and you are expected to use it.** Choose the interaction. Choose the copy. Add the affordance the flow obviously needs and the work order failed to name. Resolve the ambiguities it left. Do not ship something technically correct but half-usable because the brief did not mention the missing half — a work order is the dispatcher's best guess at the product, written without having built it, and it is not scripture.

**The price of that authority is a short written justification.** In the PR body, a section that names each real product call: what you chose, what you rejected, and why. Two or three sentences each. If a call you want to make **contradicts an acceptance criterion**, that is allowed — say so explicitly, make the case, and implement your call; what is not allowed is silently narrowing the milestone, or leaving a criterion unmet without saying that you did.

**What is not yours to move**, because it is settled and re-litigating it wastes the run: the binding decisions — `DESIGN.md` in full, D-18 (correction-forward, error-once), D-19 (the knowledge model and the `known` gate), D-22 (speaker filtering local and recall-first), D-23 (register), D-24 (the calm habit layer and its ban list), E-17 (one findings truth), the money spine (reserve-before-call, the hard cap, spend recorded when a call resolves), and the rule that a shipped migration is never edited. Also not yours: **another milestone's scope.** A product call that belongs to a later milestone is a note in your exit report, not a diff — the dispatcher will route it.

**And subtraction still wins ties.** D-26 exists because this product acquired too many concepts, not too few. When two designs are close, ship the one with fewer things on screen.

---

## Amendment 1 — 2026-07-25 · D-27: the syllabus is the backbone, recordings are the overlay

The operator, clarifying what "one session a day, like Duolingo" means: *"you should really mostly integrate the vocabulary and grammar and stuff that is in the knowledge base that we worked on, and only integrate the findings from the recordings if there are any. But the backbone should be your lessons, like Duolingo."*

This **inverts** D-17's original ordering, and criterion 9 above is amended accordingly. Read D-27.

10. **A day with nothing recorded is a complete day.** The daily session draws its lesson from E-26's 30,786-lemma lexicon and 266-rule syllabus at the learner's knowledge edge; slips and unspent findings are **woven in when they exist**, not the source the session is built from. FSRS-due reviews stay first — spaced repetition is not negotiable. **Acceptance, and this is the test that matters: a learner who has never recorded anything, or who last recorded ten days ago, opens the app and gets a full, non-degraded session** — not an empty state, not a prompt to go record something, not a shortened day. Test it on a database with zero sessions and zero findings, and drive it in a browser. This is now the *primary* path, not the fallback; a session that silently gets thinner as the recordings dry up fails this criterion.
11. **The differentiator must still be visible.** What makes the session *the learner's* is which rules and which frequency bands they are shown at all, their placement level, their due reviews, their slips woven in, and their tutor's targets. Do not let "the syllabus is the backbone" flatten into a generic course: state in the PR body what, on a recording-less day, is still specific to this learner. If the honest answer is "nothing", say so — that is a finding worth having.
