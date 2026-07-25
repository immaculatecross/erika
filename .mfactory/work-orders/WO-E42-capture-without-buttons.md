# WO-E42 — Capture without buttons

Target repo: github.com/immaculatecross/erika · Branch: `feat/e42-capture-without-buttons` · **Review tier: Full**
Batch: **solo, first in the chain.** WO-E43 (the tutor) is *pipelined* behind it — dispatched while this one is in review, sharing no file and no read-model, and merged strictly after it. They are deliberately **not** a parallel batch: both carry a migration, and the one-migration-per-batch rule exists because a v0.6 renumber left a permanently unbootable database. **This work order owns migration v28**; E-43 owns v29 and assumes v28 landed first. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual — do not touch those two files.

Read first, in this order: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-42), `DECISIONS.md` (**D-26 is the reason this milestone exists**; also D-3, D-9, D-10, D-20, D-25), `HANDOVER.md`, `CLAUDE.md`, `DESIGN.md`, then `.mfactory/playbooks/task.md`, which you execute.

## Objective

Today, between "I stopped talking" and "analysis is running" there are three taps and a manual page reload: **Stop** auto-uploads, then the learner must notice the ingest finished (the home never polls), press **Analyze** to see an estimate, then press **Start**. Analysis is never automatic. The operator's verdict: *"there should not be any button there. You know, just record — once the recording is over, just validate that, and then it should upload automatically, process. You don't have to hit multiple buttons."*

When this is done, a learner records or drops a file, confirms **once**, and everything else — upload, ingest, analysis, findings — happens by itself, visibly, without a reload and without a price tag on the screen. The analysis report stays exactly as good as it is; it stops being a checkpoint and becomes somewhere you may go.

A second, quieter objective rides along because it lives on the same path and is a lie about the learner's own life: **`sessions.created_at` is the upload instant, not the capture instant**, so a take recorded at 08:10 and uploaded at 21:30 is reported as an evening recording, and Focus's local-hour histogram is wrong with it.

## Acceptance criteria

Each is an observable outcome and becomes at least one test. "Verified" for anything user-facing means **driven on a built server**, not read (see Verification).

1. **One confirmation, then nothing.** After a mic take ends, exactly one deliberate confirmation stands between the learner and a running pipeline — a calm "keep this take / discard" carrying the duration. On keep: upload → ingest → **analysis, automatically**. Choosing a file in the upload path *is* that confirmation; no second step follows it. Assert by counting the interactive elements on the path in a rendered-DOM test, not by reading the source.
2. **No Analyze button on the capture path.** `data-inline-analyze` and `data-analyze` (`components/session-row.tsx:116`, `components/analysis-panel.tsx:313`) and their "Start analysis" successors leave the flow. A test asserts that a session row for an ingested-but-unanalyzed session offers **no** analysis control and that the session reaches `analyzed` with zero further interaction.
3. **Analysis is enqueued server-side, not by the browser.** Today `POST /api/sessions/[id]/analysis` is browser-driven, so closing the tab strands the session. The enqueue must happen where ingest completes (the worker / job pipeline), so a learner who records and immediately closes the laptop still comes back to findings. Test: complete an ingest job with no client present at all and assert an analysis job exists.
4. **The home reflects progress without a manual reload.** `app/page.tsx` calls `load()` only on mount and after upload. It must follow the session through its states — reuse the existing polling hooks (`lib/use-ingest.ts`, `lib/use-analysis.ts`, `lib/poll.ts`), including their 404/410 stop behaviour (E-16). Copy is factual and calm, in DESIGN.md's voice: what is happening and roughly how far along — never a percentage the code cannot honestly compute.
5. **Migration v28 — a real capture timestamp.** Add `sessions.captured_at`. Sources, in order: the mic recorder reports the instant the take *started*; an uploaded file's embedded creation time via `ffprobe` when present and sane; otherwise the upload instant. Existing rows backfill to `created_at` — the best value that exists — and `docs/schema.md` says so in the same PR (`tests/migrations.test.ts` enforces the pairing). **v28 is the next free number** (v24 was withdrawn and is repaired by `lib/migrations/reconcile.ts`; never renumber a migration — v0.6 left a permanently unbootable database that way).
6. **Every "when the learner spoke" claim reads `captured_at`.** This is an invariant fix, not a field swap — the fifth of v0.6's five mirror-image repairs was exactly this mistake made once already. Enumerate: grep `created_at` across `lib/`, `app/`, `components/`, classify **every** hit as *when they spoke* or *when the row was made*, and put the enumeration in the PR body. At minimum `lib/today-thread.ts` and `lib/slip-hours.ts` (the local-hour histogram) are in the first class. Test the headline case end to end: recorded 08:10, uploaded 21:30 → reported as **morning**, and binned into the 08:00 bucket.
7. **Money leaves the capture flow, and stops being a lie about the standing cost.** Delete the estimate surfaces on this path (`components/session-row.tsx:77,93`; `components/analysis-panel.tsx:240,259-265`). Settings keeps the budget input and the month-to-date figure — one place, not fourteen. In exchange, Settings must state plainly, in prose a non-engineer reads once: **an OpenAI API key is required**, **recordings are analyzed automatically when they finish uploading**, and **what the monthly cap is and what happens when it is reached.** Today the only place a new user learns a key is needed is a leaked internal error string. Automatic spending makes this disclosure *more* obligatory, not less — that trade is the whole reason removing the price tags is honest.
8. **The cap holds a session; it never fails one.** At the budget cap the session ingests, is kept, and says so truthfully with a way forward (a working link to Settings — today the copy says "raise the cap in Settings" and links nowhere), and it resumes when headroom exists without the learner re-uploading. Reserve-before-call, the hard cap and spend-recorded-on-resolve are unchanged; you are changing *presentation and recovery*, never the money spine.
9. **No key is a permanent condition and must be described as one.** Post-`#63` a keyless worker drains ingest and refuses analysis per job. The UI must say that in words that are true for a permanent condition and point at the fix — never *"unavailable right now"*, the copy pattern RETRO-004 named thirteen times over.
10. **The report survives, demoted.** `app/sessions/[id]/page.tsx` and `components/analysis-report.tsx` keep their behaviour and stay reachable from the session row. A manual re-analyze may live **there** for a session whose analysis failed; that is a detail-page repair affordance, not a step in the flow.
11. **The cold-start keyless test must construct its cold start.** `tests/coldstart-keyless-worker.test.ts:49` spawns the worker with `cwd: process.cwd()`, so it loads the repo's real `.env.local`; on a configured machine both its assertions fail **and it makes a live billed OpenAI call**. Fix the isolation (explicit env, a `.env.local`-free working directory, or an explicit opt-out the worker honours) and add an assertion that the keyless path performs **no network call at all**. Invariant to state in the code comment: *a cold-start test constructs the cold start; it never inherits the host's.* Both tests pass on a machine that has a key **and** on one that does not — demonstrate both.

## What this milestone deletes

D-26 makes subtraction the deliverable. Your PR body must carry a **"What this deletes"** section naming the concepts removed, not just the lines. Expected here: two Analyze controls and their estimate round-trip, five cost surfaces on the capture path, the manual-reload requirement, and the browser's role as the thing that starts analysis. If your diff adds concepts on net, say so explicitly and justify it.

## Files and constraints

Likely centre of gravity: `components/recorder.tsx`, `app/page.tsx`, `lib/sessions.ts`, `lib/finalize-upload.ts`, `lib/jobs/**` (ingest completion → analysis enqueue), `components/session-row.tsx`, `components/analysis-panel.tsx`, `lib/migrations/v28-capture-time.ts` + `lib/migrations/index.ts`, `docs/schema.md`, `lib/today-thread.ts`, `lib/slip-hours.ts`, `app/settings/page.tsx`, `tests/coldstart-keyless-worker.test.ts`.

Must not break: `lib/findings-model.ts` as the one findings gate (E-17, CLAUDE.md); reserve-before-call + the hard cap + spend recorded when a call *resolves* (E-16, E-27); the append-only `evidence` triggers (v14); tus upload + the streamed fallback (D-25); the E-16 resumable/idempotent ingest contract — a killed job still resumes where it stopped, and a second worker still cannot re-run a live job. DESIGN.md is binding: springs not durations, one signature moment per surface, no third accent hue, `prefers-reduced-motion` degrades to fades, copy quiet and exact.

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file (pre-commit hook), never edit a shipped migration, never commit `data/` or `.env*`, disposable database only — `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, **never** `data/erika.db` (an agent once pushed an unmerged migration onto the operator's real database).

## Out of scope

The Learn tab in any form; the tutor (WO-E43 owns `lib/tutor/**` and is running in parallel); lesson or card content (WO-E45); the first-run onboarding gate and the progress surface (WO-E46); rate-table corrections beyond what criterion 7 needs; `FEATURES.md`/`STATE.md` (the dispatcher's ritual); the five stale remote `fix/*` branches.

## Verification (this repo's five hard-won rules apply)

1. **Drive the built app.** E-37 shipped a page unreachable on every route while 958 tests passed and three Full reviews read the branch. Build, run, and walk the whole capture path on a **fresh, disposable database**, keyless and keyed.
2. **Prove which server answered you.** Bind an unusual port and prove the responder is your own build (assert a string unique to it, or check the process) before trusting a single result. State the proof in your exit report. A verification once silently hit another session's stale server and returned confident, wrong answers.
3. **Mutation proof, on every new guard.** Break the thing deliberately, show the test go red, restore, quote the output in the exit report. Expectations come from the fixture, never from the artifact under test. Four tests that could not fail shipped in v0.6 — including the one written to fix the third.
4. **Fix invariants, not instances.** Before writing criterion 6, state the invariant and enumerate every path that could violate it; then ask what the *opposite* failure looks like. Five v0.6 repairs created their own mirror image.
5. **Check the repo's own research before writing any constant.** Two v0.6 money defects were already documented correctly, with citations, in `docs/research/` before the wrong number was written.

Gates: `npm run lint` · `typecheck` · `test` · `build` all green, plus the tripwires. **Branch and push first** — an empty commit and `git push -u origin feat/e42-capture-without-buttons` as your very first action, before any code, because an interrupt kills a detached worker with no durable trace.

## Exit report

Append to this file per `.mfactory/playbooks/task.md`, and **write it here before you return** — a deliverable that exists only as a return value can evaporate, and has. Include: the criterion-by-criterion status; the "What this deletes" list; the full `created_at` enumeration from criterion 6; the mutation proofs with quoted output; the proof of which server answered your walkthrough; and anything you could not verify, named plainly rather than smoothed over.

---

## Amendment 1 — 2026-07-25, from the Full review of PR #66 (merged)

Three findings from that review were priced as non-blocking and assigned here, because they live on the Record/analysis path this milestone owns. They are **acceptance criteria, not suggestions**.

12. **The composed deep prompt now contradicts itself about register.** `lib/register.ts`'s `registerInstruction` says the dial "never [changes] what is correct"; `lib/mistakes.ts` class B says a register slip **is** a mistake; and the comment at `lib/analysis/prompts.ts:90-91` is now false. D-23 says the dial is *"style only, never correctness"*. Resolve it into **one coherent statement** rather than two sentences that disagree, and fix the false comment. The defensible reading — PRODUCT.md leads with catching *"phrasing a native would never choose"* — is that the dial sets the **target register a slip is judged against** while still never overriding grammatical correctness; if you adopt it, say so once, in one place, and make the prompt say it once. Also state explicitly whether a register finding is cardable, because criterion 14 depends on the answer.
13. **The deep prompt grew 1,900 → 7,392 characters (+1,373 tokens) and prompt text is not priced at all.** `gpt-audio-mini` bills its text tokens at **$0** — an audio-input floor with no allowance for prompt or JSON — on the most-used money path, and this milestone makes analysis **automatic**, so the error now compounds on every recording without anyone pressing anything. Fix the rate to include prompt and output text tokens, pin it as a **floor**, and name the dangerous direction at the definition site: over-estimating costs a slightly early refusal, under-estimating makes the cap a lie. Cross-check `docs/research/` before writing the number — this repo has twice written a constant that its own research already contradicted.
14. **The parser refuses the one label the prompt now invites.** `register` is instructed but is not an accepted category, and the failure mode is that the **whole segment is lost**, not just that one finding. Either accept it end to end (prompt → parse → persist → surface, with a test per criterion 3 of the E-39 work order) or stop inviting it. A class the model is asked to produce and the schema silently discards is the exact defect PR #66 existed to remove.

---

## Standing clause — product authority (operator directive, 2026-07-25)

Operator, on approving the v0.7 plan: *"aim for a really complete, usable, intuitive consumer product. Each one of those can have solutions — really make product calls, after thinking well and justifying them a little bit."*

**So the bar is not "the acceptance criteria are satisfied." The bar is that a person who has never seen this repository can use the thing end to end, without asking a question, and want to come back tomorrow.** If a criterion is ticked and that sentence is still false, the milestone is not done.

**You have product authority inside this milestone's scope, and you are expected to use it.** Choose the interaction. Choose the copy. Add the affordance the flow obviously needs and the work order failed to name. Resolve the ambiguities it left. Do not ship something technically correct but half-usable because the brief did not mention the missing half — a work order is the dispatcher's best guess at the product, written without having built it, and it is not scripture.

**The price of that authority is a short written justification.** In the PR body, a section that names each real product call: what you chose, what you rejected, and why. Two or three sentences each. If a call you want to make **contradicts an acceptance criterion**, that is allowed — say so explicitly, make the case, and implement your call; what is not allowed is silently narrowing the milestone, or leaving a criterion unmet without saying that you did.

**What is not yours to move**, because it is settled and re-litigating it wastes the run: the binding decisions — `DESIGN.md` in full, D-18 (correction-forward, error-once), D-19 (the knowledge model and the `known` gate), D-22 (speaker filtering local and recall-first), D-23 (register), D-24 (the calm habit layer and its ban list), E-17 (one findings truth), the money spine (reserve-before-call, the hard cap, spend recorded when a call resolves), and the rule that a shipped migration is never edited. Also not yours: **another milestone's scope.** A product call that belongs to a later milestone is a note in your exit report, not a diff — the dispatcher will route it.

**And subtraction still wins ties.** D-26 exists because this product acquired too many concepts, not too few. When two designs are close, ship the one with fewer things on screen.

---

# Exit report — WO-E42, worker session 2026-07-25

```
RESULT:  done
PR:      https://github.com/immaculatecross/erika/pull/<opened after this file is pushed> · branch feat/e42-capture-without-buttons
Changed: see "Criterion by criterion" and "What this deletes" below
Verified: npm run lint · typecheck · test (1107 passing, 133 files) · build — all green;
          plus a browser-driven walkthrough of the built server on a disposable DB,
          keyless and keyed (see "Which server answered"), and 15/15 mutation proofs.
Tests changed/removed: listed in full below.
Risks:   listed in full below.
Review tier: Full (unchanged — money, a migration, and the ingest/analysis path).
```

## Criterion by criterion

| # | Status | Evidence |
|---|---|---|
| 1 · one confirmation, then nothing | **met** | `components/recorder.tsx` holds the take and asks once (`data-take-confirm`, keep/discard, duration shown). Choosing a file in the upload path *is* the confirmation — no second step. Counted from the rendered DOM, not the source: `tests/session-row-render.test.tsx` and `tests/capture-confirm-render.test.tsx` count `<button>` elements on both capture surfaces and assert **0** in every non-repair state; `e2e/recorder.spec.ts` drives the real MediaRecorder flow and asserts exactly two choices and that nothing is uploaded before "Keep". |
| 2 · no Analyze button on the capture path | **met** | `data-inline-analyze`, `data-analyze`, `data-confirm-analyze` and the whole estimate→Start chain are deleted. `sessionPhase` replaces `analyzeGate`. A session row for an ingested-but-unanalysed session renders zero interactive elements and reaches `analysed` with no interaction (live proof: the walkthrough below). |
| 3 · analysis enqueued server-side | **met** | `lib/analysis/auto.ts`; `enqueueAfterIngest` runs inside the ingest job's `done` transaction. `tests/capture-flow.test.ts` drives a **real** ingest with no route, no fetch and no React, and asserts a queued analysis job exists and survives a reopen. Live: `[worker] ingest → done` then `[worker] analysis job …` in the same tick, no browser open. |
| 4 · the home reflects progress without a reload | **met** | `lib/use-sessions.ts` reuses `pollAction` (lib/poll.ts) verbatim, including 404/410 stop. Stops when everything settles. Copy is stage words, never a percentage ingest cannot honestly compute; the one number shown is the analysis run's completed-segment ratio. `e2e/analysis-ui.spec.ts` proves the home advances without navigation and then stops polling. |
| 5 · migration v28 — a real capture timestamp | **met** | `lib/migrations/v28-capture-time.ts`, `lib/capture-time.ts`, `docs/schema.md` in the same PR. Sources in order: mic take-start → embedded `creation_time` via ffprobe → file mtime hint → upload instant. Existing rows backfill to `created_at`. |
| 6 · every "when they spoke" claim reads `captured_at` | **met** | Full enumeration below. All 7 SQL read sites converted; the carrier fields are **renamed** (`sessionCreatedAt`→`sessionCapturedAt`, `AnalysedSessionRow.createdAt`→`capturedAt`) so the type says what it is. Headline case tested end to end. |
| 7 · money leaves the flow; Settings discloses | **met** | Estimate route and both cost surfaces deleted. Settings gains a prose block stating the key requirement, that analysis is automatic, and what the cap does — outside the loading guard, so it renders even if the fetch fails. |
| 8 · the cap holds a session, never fails one | **met** | `resumeHaltedAnalysis`. Verified live: capped → `budget-reached` with a working `/settings` link → budget raised → worker resumed the same job → `done`, with no re-upload. |
| 9 · no key is a permanent condition | **met** | `needs-key` is its own phase with its own copy and a link. No "right now"/"just now"/"temporarily" anywhere. **Plus a fix the criterion did not ask for** — see product call 5. |
| 10 · the report survives, demoted | **met** | `app/sessions/[id]/page.tsx` and `components/analysis-report.tsx` unchanged in behaviour, reachable from the row. A `Try again` repair exists on the detail page for a genuinely failed run only. |
| 11 · the cold-start test constructs its cold start | **met** | Isolated cwd + `ERIKA_NO_ENV_FILE` opt-out + a network sensor. Demonstrated in three configurations, and the original defect reproduced. |
| 12 · one coherent statement about register | **met** | Stated once in `lib/register.ts`; the false comment at `lib/analysis/prompts.ts` now points there instead of restating it. A register finding **is cardable** — it is a `vocabulary` finding. |
| 13 · text tokens priced, as a floor | **met** | Rate table rebuilt on published per-token prices; per-call text cost added; `tests/rates-text-floor.test.ts` pins the allowance against the **actual** prompt builders. |
| 14 · `register` accepted end to end | **met** | Prompt → parse → persist → surface, stored as `vocabulary`. `tests/register-category.test.ts`. |

## What this deletes

Concepts, not lines. Net concept count is **down**.

1. **The Analyze button, twice over** — the inline one on the sessions row and the one on the session page, with their `estimating → confirm → starting` state machines and their Cancel partners. Four controls.
2. **The pre-run estimate round-trip** — `GET /api/sessions/[id]/analysis/estimate` (route deleted), the `Estimate` interface in two components, and the idea that a learner approves a price before each run.
3. **Five cost surfaces on the capture path** — `est. $X` on the row, `Estimated cost` and `Remaining this month` as display figures, the "N segments to analyze · budget $X/month" line, and the `data-budget-reached` panel's spend arithmetic. Money now exists in exactly one place, Settings.
4. **The manual-reload requirement** — the home no longer needs a human to press refresh to learn that anything happened.
5. **The browser as the thing that starts analysis** — the whole notion that closing a tab can strand a recording.
6. **`analyzeGate`** — an affordance-gate concept, replaced by a state concept (`sessionPhase`). Not a rename: it answers a different question.
7. **`analysisPending` and `analysedSpeechMs`** on the list item — one was a flag for a button that no longer exists, the other a figure nothing rendered.
8. **A redundant second authority** on whether to offer a retry (found dead by mutation testing, see below).
9. **The conflated per-minute rate** — one number that silently carried "some text allowance" becomes an explicit audio rate plus an explicit text cost.

**Added on net:** the `SessionPhase` state machine (10 states) replaces `AnalyzeGate` (6 states). That is +4 named states, and it is deliberate: three of the new ones (`needs-key`, `budget-reached`, `analysis-failed`) exist precisely because collapsing them is how "unavailable right now" got written over a permanent condition thirteen times. The learner sees **one** sentence either way; the count is internal.

## Criterion 6 — the full `created_at` enumeration

`grep -rn "created_at\|createdAt" lib/ app/ components/` → **189 hits**. Every one classified.

**SPOKE (46 hits) — reached through exactly 7 SQL read sites, all now converted:**

| # | Site | Was | Now |
|---|---|---|---|
| 1 | `lib/sessions.ts` `SELECT` | `s.created_at` → `Session.createdAt`, rendered as the row date and as "Captured" | selects **both**; `capturedAt` added; UI reads `capturedAt` |
| 2 | `lib/sessions.ts:90` `ORDER BY` | upload order | `capturedAtSql() DESC`, `created_at` as tiebreak |
| 3 | `lib/findings-model.ts` `listAnalysedSessions` | `s.created_at AS created_at` | `capturedAtSql() AS captured_at`; field **renamed** `capturedAt`. Upstream of Focus's trend order, the letter's ISO weeks, and `analysedSessionDates` (the slips remission ruler) |
| 4 | `lib/findings-model.ts` `listIncludedFindingsWithSession` | `s.created_at AS session_created_at` | `capturedAtSql() AS session_captured_at`; renamed `sessionCapturedAt`. Upstream of the Archive and Focus's local-hour histogram |
| 5 | `lib/slips.ts` `listSlips` | `MIN/MAX(s.created_at)` | `MIN/MAX(capturedAtSql())` — a slip's first/last occurrence |
| 6 | `lib/slips.ts` `getSlipDossier` | `s.created_at AS at` | `capturedAtSql() AS at` — the occurrence dates shown to the learner |
| 7 | `lib/today-thread.ts` | `s.created_at` as the spoken instant + the day prefilter | `capturedAtSql()` throughout |

Downstream carriers renamed with them (no logic change, but the type now states the claim): `lib/analysis/findings.ts` `FindingWithSession`, `lib/archive.ts` (3 interfaces), `lib/slip-hours.ts` `SlipHourInput`, `lib/focus.ts` `AnalyzedSession`, `lib/letter.ts` `LetterSession` + `isoWeekStart`, `lib/slip-standing.ts` doc. UI: `app/sessions/[id]/page.tsx` (the field literally labelled "Captured"), `components/session-row.tsx`, `app/archive/page.tsx`, `app/slips/[id]/page.tsx`.

**ROW (128) and ROW-DDL (38+) — deliberately untouched.** Job age and lease/heartbeat bookkeeping (`lib/jobs/lease.ts`, `liveness.ts`); the analysis-job queue order (`cascade.ts`); `evidence.created_at` (mint time — `lib/knowledge/`); `spend_ledger` month keys; card/lesson/rendition/ask-note/attempt/enrollment/placement row times; `_migrations`; every `DEFAULT (datetime('now'))` in the migration files; row-insertion tiebreaks.

**The opposite failure, asked before writing the fix.** Swapping *every* `created_at` for `captured_at` would be exactly as wrong: a resumed ingest would look stale, a month's spend would land in the wrong month, and the FSRS fold would reorder. So the rule is one-directional and enforced structurally — `tests/capture-time.test.ts` walks `lib/`, `app/` and `components/` and fails if any file outside `lib/sessions.ts` reads `s.created_at`. **That guard caught my own regression during this run**: `lib/analysis/auto.ts` ordered its sweep by `s.created_at`. It is now ordered by the ingest job's age, which is what a queue actually means.

**Two `created_at` reads I did NOT change, and why.** `lib/knowledge/derive.ts:170` derives `distinctCorrectDays` from `evidence.created_at` — the mint instant, not the speaking instant, so D-19's "≥2 correct events on ≥2 days" is counted on the wrong clock for audio-derived evidence. It is the same invariant, but fixing it changes the `known` gate, which is a binding decision (D-19) and E-45's surface. **Dispatcher: this is a note, not a diff.** Second: `evidence` has no capture column and its v14 triggers are append-only, so any fix there needs its own migration.

## Product calls

**1 · The home polls the LIST, not two hooks per row.** *Chosen:* a `useSessions` hook that reuses `pollAction` from `lib/poll.ts` — the shared 404/410 authority the criterion names — against `GET /api/sessions`. *Rejected:* instantiating `useIngest` + `useAnalysis` per row, the literal reading. That is 2N requests per second on a screen that lists everything the learner has ever recorded, and `listSessionItems` already answers all of it in a fixed number of queries. The per-session hooks stay in use on the detail page, unchanged.

**2 · The sessions list is ordered by capture time.** *Chosen:* newest **recording** first. *Rejected:* keeping upload order. A list whose dates are capture dates, sorted by something else, is incoherent — a file recorded last Tuesday would sit above one recorded this morning. *Cost, stated plainly:* uploading an old recording drops it into its true date rather than to the top. Mitigated by the inline "Uploading …" state next to the control the learner just used.

**3 · A file's modification time is used as a weak capture hint.** The work order named three sources; for the headline case it names (a day dump recorded at 08:10, uploaded at 21:30) most real files carry no embedded `creation_time`, so the flow would have fallen straight to the upload instant — the exact lie this milestone exists to remove. mtime is never *further* from the truth than the upload instant, so it strictly improves the answer; it is ranked below embedded metadata and can never move a capture time later than the upload.

**4 · The keep/discard confirmation is a real decision, not a formality.** D-26 says subtract, and I added a step to the mic path. *The case:* the alternative is worse in both directions — auto-uploading every take makes a mis-tap cost real money and puts a bystander's voice into evidence with no chance to say no beforehand, while a take you cannot discard must be deleted afterwards, which is more steps. It also carries the take's duration, without which "keep this?" is unanswerable. The upload path needs no equivalent because choosing a file already *is* a deliberate confirmation.

**5 · A key-refused analysis retries itself once a key appears — and this contradicts nothing, but goes beyond criterion 9.** Found by driving the built app, not by reading the diff. Refusing a keyless job *terminally, per job* is right (RETRO-004 §DE-1). But `failed` is terminal for the claim **and** the reclaim, so a learner who did exactly what the UI told them — add the key, restart the worker — came back to a recording still saying "waiting for an API key", **with no way to run it**, because this milestone removed the Analyze button that used to be their escape. That is the mirror-image failure five v0.6 repairs produced. `resumeKeylessRefusals` moves the wall when the reason for it moves, gated on a key actually being present and on the stored error being the missing-key message.

**6 · The partial-run qualifier moved onto the home.** A budget-halted run leaves a session `analysed` with 1 of 15 segments heard. "No mistakes found" over that is the E-16b lie, and making runs automatic is what puts that state in front of everyone. The row now reads `No mistakes found · heard 1 of 15`.

**7 · The rate table is rebuilt on published per-token prices rather than patched.** Criterion 13 asks for text to be priced; adding a text term *on top of* the existing conflated per-minute figure would double-count and distort the cap by ~2×. Deriving audio and text separately from the figures `docs/research/spike-1`/`spike-3` already carried is the honest fix. *Consequence I am flagging, not hiding:* this also lowers `gpt-audio`'s per-minute figure from $0.05 to its researched $32/1M audio-in — the separately-tracked "priced 2.6× above its own cited table" item — as a side effect. The **total** per call still rises, and `tests/rates-text-floor.test.ts` asserts every leg is at or above the researched price.

**8 · A register slip is a `vocabulary` finding, and therefore cardable.** Criterion 14 offered "accept it or stop inviting it". A sixth category would need a `findings` CHECK-constraint rewrite and fragments a vocabulary E-45 wants simpler; removing the invitation loses signal PRODUCT.md leads with. So: accepted end to end, stored as `vocabulary`, and the prompt now says so explicitly so the alias is a safety net rather than the only thing between us and a lost segment.

**9 · The Settings disclosure renders outside the loading guard.** Found by driving the built server: the block was inside `if (!form) return …`, so a new user saw it only after a successful fetch and never if that fetch failed — recreating the defect it exists to fix.

**10 · One worker-absent notice for the screen, not one per row.**

## Mutation proofs — 15 of 15 killed

Each mutation is a plausible regression (the code as it was, or an obvious "simplification"), applied to the real source, with the named test run and then restored.

```
C3  ingest completion no longer enqueues analysis
    RED | Tests  3 failed | 13 passed (16) | → expected null not to be null
C3  the sweep stops covering sessions the per-completion enqueue missed
    RED | Tests  1 failed | 15 passed (16) | → expected [] to deeply equal [ 's0' ]
C6  the findings read-model reads the UPLOAD instant again
    RED | Tests  2 failed | 13 passed (15) | → expected '2026-07-25 21:30:00' to be '2026-07-25 08:10:00'
C6  a NULL captured_at drops the session out of the histogram (no COALESCE)
    RED | Tests  1 failed | 14 passed (15) | → expected null to be '2026-07-25 21:30:00'
C5  the mic recorder's declared take-start is ignored
    RED | Tests  2 failed | 13 passed (15) | → expected '2026-07-25 12:00:00' to be '2026-07-25 08:10:00'
C8  the cap resume forgets to check for headroom
    RED | Tests  1 failed | 15 passed (16) | → expected [ Array(1) ] to deeply equal []
C9  the key-arrives retry fires even with no key (the refusal loop returns)
    RED | Tests  1 failed | 15 passed (16) | → expected [ Array(1) ] to deeply equal []
C13 gpt-audio-mini's text tokens go back to $0
    RED | Tests  2 failed | 6 passed (8)   | → expected 0 to be greater than or equal to 6e-7
C13 the deep prompt allowance is set below the prompt actually sent
    RED | Tests  2 failed | 6 passed (8)   | → expected 900 to be greater than or equal to 2222
C14 `register` is refused again, losing the whole segment
    RED | Tests  2 failed | 2 passed (4)   | → Finding 1 has an invalid `category`.
C12 the register instruction goes back to contradicting lib/mistakes.ts
    RED | Tests  2 failed | 9 passed (11)  | → expected '…' to match /never overrides what is grammaticall…/i
C2  an Analyze control comes back to the sessions row
    RED | Tests  2 failed | 11 passed (13) | → expected 1 to be +0
C7  a cost estimate reappears on the sessions row
    RED | Tests  1 failed | 12 passed (13) | → expected '<div data-session-row…' not to match /\$|USD|est\.|budget remaining/i
C9/C10 the analysis panel offers a retry for a missing key
    RED | Tests  1 failed | 6 passed (7)   | → expected [ '<button' ] to have a length of +0 but got 1
C4  the home stops treating a capped session as still moving
    RED | Tests  3 failed | 13 passed (16) | → expected false to be true
```

**One mutation initially SURVIVED, and that is the most useful result here.** `onRetry={isMissingKeyMessage(view.error) ? null : retry}` at the `AnalysisPanel` call site could be deleted with every test still green — because `Stopped` already branches on `needsKey` before it looks at `onRetry`. A second copy of the same rule, and a dead one: exactly the `isAssumedRunLeaseHash` shape RETRO-004 named. The duplicate is deleted, `Stopped` is the single authority, and the mutation on **that** predicate is killed.

**The network sensor proves itself.** `tests/coldstart-keyless-worker.test.ts` asserts an empty network log — worthless if the sensor could not detect anything — so a companion test runs the same preload against a process that deliberately opens a connection and requires the log to catch it, by resolved address. Writing it found a real blindness: Node passes `Socket.prototype.connect` its internal `normalizeArgs` array, so the first version recorded every target as `?:?`.

## Which server answered the walkthrough

Bound to an unusual port (**41287**) against a disposable DB (`ERIKA_DATA_DIR`/`ERIKA_DB_PATH` under an OS temp dir — never `data/`), and proved on three independent axes before a single result was trusted:

1. **Process identity.** `lsof -nP -iTCP:41287 -sTCP:LISTEN -t` → pid **90164**; `lsof -a -p 90164 -d cwd` → `/Users/…/.claude/worktrees/agent-a86fe147e01b1430f` — my worktree, not the operator's checkout and not another session's.
2. **A field that exists only on this branch.** `GET /api/settings` returned `"analysisKeyPresent":false` — added by criterion 7 and present in no other build.
3. **Prose that exists only on this branch.** The served `/settings` HTML contains `Recordings are analyzed automatically when they finish uploading` and `OPENAI_API_KEY=sk`.

The UI was driven in a **real headless Chromium at a 402px phone viewport**, reading the rendered DOM (curl cannot see it — the home is a client component). Zero page errors and zero console errors across every route visited.

### What the walk showed

| Step | Result |
|---|---|
| Upload declared as recorded 08:10, uploaded 11:01 | `capturedAt 2026-07-25 08:10:00`, `createdAt 2026-07-25 11:01:50` — row and detail page both read **10:10 AM** local, never 13:01 |
| Home before any worker | `phase=ingest-queued`, `Waiting — the worker isn't running`, one worker-absent notice, **0** buttons matching `/analy[sz]e/i`, **no money in the visible text** |
| Worker (keyless) | `ingest → done`, then `analysis job …` **in the same tick, with no browser open**, then `refused: no OPENAI_API_KEY is set…` |
| Home after | `phase=needs-key`, `Waiting for an API key`, action → `/settings` ("How to add one"), polling **stopped** |
| Settings | disclosure present; `No key is set right now, so analysis will not run.`; states the key requirement, that analysis is automatic, the monthly budget, that it is a hard cap, and that held recordings resume on their own |
| Real Italian speech (TTS, five planted errors), keyed worker | upload → ingest → **analysis, automatically** → `done`. **4 findings**: `Penso che sia vero` (congiuntivo), `In realtà sono molto stanco` (false friend), `ieri sono andato al cinema` (passato prossimo), `con i miei genitori` (false friend). Correction-forward: corrections lead, errors hidden until expanded (D-18 intact) |
| Home | `4 mistakes · mostly grammar`, capture time 10:30 AM, ordered above the earlier recording |
| Key arrives for the stuck session | `key found — retrying analysis …` → `done`, with no interaction at all |
| Budget cap (set below spend), new recording | ingest ran, analysis `halted: Monthly budget reached.`; row reads `Paused — this month's budget is spent` with a working `/settings` link and **still in flight** |
| Budget raised to $5, worker run | `resuming halted analysis …` → `done`. **No re-upload.** |

### Criterion 11 in both configurations, and the defect reproduced

```
A. host has NO key, no .env.local          Tests  4 passed (4)
B. host HAS a key in its environment       Tests  4 passed (4)
C. a real .env.local in the repo root      Tests  4 passed (4)
D. the ORIGINAL code, in configuration C:
     → expected '[worker] started (1 var(s) from .env.…' to match /ingest will run normally/i
     → expected 'gpt-audio call failed: 401 Unauthoriz…' to be 'no OPENAI_API_KEY is set, so analysis…'
   Tests  2 failed | 2 passed (4)
```

D is the criterion's own description, demonstrated: on a configured machine the old test's assertions inverted **and it made a live call to OpenAI**. The temporary `.env.local` carried an obviously-fake key and was removed; `git ls-files | grep env.local` → 0.

## Money

**$0.086 of real OpenAI spend**, against the $0.50 allowance.

* TTS to synthesize the Italian test clip (136 chars, `gpt-4o-mini-tts`): ~$0.0016
* 6 real `gpt-audio-1.5` deep calls over 30 s of audio: ~$0.0096 audio-in + ~$0.075 text
* The app's own ledger recorded **$0.1213 modelled** for the same work — deliberately above reality, which is the only safe direction (criterion 13).

The key was read directly from the operator's `.env.local` into a single process's environment. It was never printed, logged, written to disk, or committed; the worker wrapper pipes stderr through a `sk-…` redactor.

## Tests changed or removed

* **`tests/analysis-route.test.ts`** — the `GET analysis estimate` describe block removed with the route it drove. POST's own budget refusal is retained.
* **`tests/session-yield.test.ts`** — the `analyzeGate` describe replaced by `sessionPhase`, broadened from 5 cases to 8 (the three new act-on-me phases are separately asserted).
* **`tests/session-row-render.test.tsx`** — rewritten. Now counts interactive elements from the DOM rather than grepping one attribute name.
* **`tests/register.test.ts`** — the assertion demanding *"style only, never what is correct"* **encoded the defect as the contract** (mfactory D-14) and passed while the composed prompt contradicted itself. Replaced with the resolved rule, plus a new test that the two halves of the prompt agree.
* **`tests/mistake-coverage.test.ts`** — `register` moved from the "returns null" list to an accepted-alias test.
* **`tests/analysis-cascade.test.ts`, `tests/analysis-concurrency.test.ts`, `tests/analysis-cost.test.ts`, `tests/richness-dial.test.ts`** — money arithmetic re-derived. Expectations are hand-computed **from the published per-token prices in `docs/research/`**, never from `callCost`.
* **`tests/analysis-panel-render.test.tsx`, `tests/honest-home-routes.test.ts`, `tests/recording.test.ts`** — updated for the removed placeholder, the yield shape, and the take's new fields.
* **~15 test/e2e files** had `UPDATE sessions SET created_at` repointed at `captured_at`. Every one of them *meant* "this session was recorded on day X", so this is a fidelity fix — and it turns them into a standing guard: reverting any read path to `created_at` reddens them.
* **Nothing was deleted to make a number look better.** Net: 1055 → 1107.

## Risks and what I could not verify

1. **`useSessions` has no unit test of its polling loop.** There is no DOM test environment in this repo (`vitest` runs `environment: "node"`; no jsdom/happy-dom in devDependencies) and adding one is a dependency change outside this milestone. The *stop condition* is a pure function and is exhaustively tested (`anyInFlight`, every phase classified); the **live** no-reload behaviour is covered by `e2e/analysis-ui.spec.ts` and by the browser walkthrough above. Named plainly: this is the one criterion whose live behaviour rests on the e2e suite, **which CI still does not run** (STATE.md §3, owed to E-39/E-40).
2. **The keep/discard confirmation is not unit-tested** — it needs `MediaRecorder`. It is covered by `e2e/recorder.spec.ts` (two new assertions) and was walked by hand. Same CI caveat.
3. **The completion-token allowance is a modelled typical, not the enforced ceiling.** 1,200 tokens against a `DEEP_MAX_OUTPUT_TOKENS` of 4,000. Booking the ceiling would be a true upper bound but roughly doubles a day dump's modelled cost against replies that are typically 300–1,800 tokens. This follows the precedent the realtime table already sets (a deliberate ~1.7× over-book, named as such). A pathologically verbose reply could exceed the model. **The real fix is the standing usage→invoice reconciliation, which needs the operator's key and is unchanged as owed.**
4. **The `AUDIO_TOKENS_PER_MINUTE = 660` figure is from secondary sources** (`docs/research/spike-1`/`spike-3`, ~600/min) plus 10% headroom. Not measured against this account's real `usage`.
5. **`gpt-audio`'s per-minute rate drops** as a side effect of rebuilding the table honestly (product call 7). The per-call total still rises. Flagging it because it is a money change the work order did not ask for.
6. **The capture-time guard is a source-text scan.** `tests/capture-time.test.ts` greps for `s.created_at`. A query that aliases `sessions` differently would evade it. It is a backstop for the *behavioural* tests around it, not the primary defence — and it already earned its place by catching my own regression.
7. **The mtime hint depends on the browser reporting a real `File.lastModified`.** Where a copy tool has reset it, the value is simply the copy time — still no worse than the upload instant, but not the capture instant either.
8. **`lib/knowledge/derive.ts`'s `distinctCorrectDays`** counts days from evidence mint time. Same invariant, D-19's `known` gate, E-45's surface — **left as a note for the dispatcher, not a diff.**
9. **No live verification of a day-scale dump.** The walkthrough used takes of 9–11 seconds. The cascade/full-deep split at 30 minutes is unit-tested but was not driven with real long audio.
