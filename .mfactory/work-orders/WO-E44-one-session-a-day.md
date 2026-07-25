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
