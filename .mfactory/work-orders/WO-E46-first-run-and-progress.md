# WO-E46 — First run, and progress you can see

Target repo: github.com/immaculatecross/erika · Branch: `feat/e46-first-run-and-progress` · **Review tier: Full**
Batch: **solo, serial, last in v0.7.** Depends on WO-E43 (the STT seam), WO-E44 (the session and the Library) and WO-E45 (the deck), all merged. Carries **no migration** unless criterion 4 forces one; if it does, it is the next free number. The **dispatcher**, not you, performs the FEATURES.md/STATE.md ritual.

Read first: `AGENTS.md`, `STATE.md`, `FEATURES.md` (row E-46), `DECISIONS.md` (**D-26**, **D-19**, **D-22**, **D-24**), `HANDOVER.md`, `CLAUDE.md`, **`DESIGN.md` in full — this milestone is judged on how it looks**, then `.mfactory/playbooks/task.md`.

## Objective

Two halves, both about a learner meeting this product for the first time and staying with it.

**First run is not real.** There is no gate anywhere: `middleware.ts` is a no-op principal stamp, the shell renders the same two tabs on an empty database, and placement is a *dismissible row* explicitly commented "never a hard gate". A new learner therefore lands in an app that knows nothing about them and never insists on learning anything. The operator: *"make sure the onboarding is a real one — when you launch the app for the first time, there's no DB, it should really force you to go through the onboarding."*

**And progress is invisible.** The knowledge core built in E-25 — every word, rule and sound the learner has shown they have — is visible only through a dev-only inspector at `/dev/knowledge`. The operator has never seen it: *"I've not seen the knowledge graph. It would be nice to see someone progressing."* And, on how it should feel: *"show progress but make it sexy and user friendly."* That is the brief, held against DESIGN.md's restraint — sexy here means beautifully made, not decorated. This ratifies the operator-gated RETRO-002 P6 proposal, a read-only "what Erika knows about you" surface.

## Acceptance criteria

1. **An empty database forces onboarding, and cannot be navigated around.** Any route on a database with no learner profile lands in onboarding — including a deep link straight to `/practice` or a Library page. A learner who *has* a profile is never trapped by it. Test both directions; the second is where this kind of gate goes wrong.
2. **Onboarding says what Erika needs, before the learner discovers it the hard way.** In plain prose, once: an **OpenAI API key is required** and where it goes; recordings are **analyzed automatically**; there is a **monthly cap**; the **worker process** must be running for anything to be processed. The server can report whether a key is actually present — say so truthfully rather than instructing blindly. Today the only place a new user learns a key is needed is a leaked internal error string on the tutor screen, and the app's own remedy for a stalled ingest was a loop; that is what failed the v0.6 cold-start gate.
3. **Keep the vocabulary check; add a voice.** The yes/no frequency-band check works and the operator said so — leave its scoring alone. Add **one or two short spoken prompts** through E-43's `SpeechToText` seam, so level is inferred from real **production** as well as recognition, and record the ~45 s E-36 enrollment take in the same pass (D-22: on-device, never uploaded). The spoken sample also gives a genuinely yes-biased advanced learner **an escape from the false-alarm refusal**, which today offers no route but retaking the check — the last open item in RETRO-004 §1.
4. **Placement's correctness rules are untouched.** Recognition-only evidence seeds `introduced` and **never** `known` (D-19). `level` remains the top of the **contiguous** run from A1; `calibrated` can never read true above the false-alarm threshold; supersession stays the INSERT-only read-path rule on `placement_runs` (v27); and the single predicate that gates **both** presentation **and** seeding stays single — a careless run must not silently seed, and an honest retake must not silently erase. Every one of those was a v0.6 blocker; re-prove them, do not merely preserve them.
5. **Onboarding ends inside a real first session.** Not a congratulations screen, not the home with a prompt — the learner's first session, composed from what the check just learned about them.
6. **Progress: what Erika knows about you.** A read-only surface showing the words, rules and sounds the learner has shown they have; what moved this week; what is still fossilized; and the knowledge map done properly rather than as a strip. Reached from the Learn home (the ring is the natural affordance) and from the Library. It **replaces** `/dev/knowledge`.
7. **Every number on it is honest, and green still means mastery.** Figures derive from the knowledge core and `computeSlipStandings` — the *same* standing Focus reduces, so the product keeps one notion of mastery. Green tints only through resolved-slip semantics; heavy activity with nothing resolved stays neutral (D-24, tested under load in v0.6 — keep that test honest). Where there is no evidence yet, say **"not started"** rather than rendering a fake 0% — the v0.6 review lenses singled out this repo's empty states as genuinely good; do not regress them. No claim of a return or a trend that no code path implements.
8. **It is the best-looking screen in the app.** DESIGN.md is binding and its restraint is the point: Apple system palette, accent black in light and white in dark, green and red **only** where a state carries meaning, tabular numerals for every statistic, cards at 18px, springs at stiffness ≈260 / damping ≈28, transform and opacity only, list stagger 30–45 ms, **one** signature moment, and `prefers-reduced-motion` degrading everything to fades. D-24's ban list applies here as everywhere: no confetti, mascots, XP, points, levels, leaderboards or badges — a progress surface is exactly where those try to creep in. Walk it in a browser in **both** light and dark and at a phone viewport, and attach what you saw to the exit report.

## What this milestone deletes

Your PR body carries a **"What this deletes"** section. Expected: `/dev/knowledge` and its API, the dismissible placement prompt, and the "discover the requirements from an error message" path. If concepts go up on net, justify it.

## Files and constraints

Centre of gravity: `middleware.ts` or the shell's routing seam, `app/practice/placement/page.tsx` + `components/placement/**`, `lib/placement/**` (scoring untouched), `lib/knowledge/**` (read-only use), `lib/knowledge-map.ts`, `lib/slip-standing.ts`, `components/knowledge-map.tsx`, a new progress route, `app/dev/knowledge/page.tsx` + `app/api/dev/knowledge/route.ts` (removed).

Must not break: append-only `evidence` and its v14 triggers; D-19's `known` corroboration; `lib/findings-model.ts` as the one gate, **including E-45's new speaker predicate**; D-22 on-device and recall-first; the E-31 `day_ledger` and `lib/streak/`; reserve-before-call and the hard cap.

Repo rules: Conventional Commits (subject ≤72 chars), 500 lines per file, never edit a shipped migration, never commit `data/` or `.env*`, disposable database only — and note that this milestone is *about* the empty-database path, so a disposable database is not merely hygiene here, it is the subject.

## Out of scope

The session runner and day completion (WO-E44, merged); lesson and card content (WO-E45, merged); the tutor internals (WO-E43, merged); the Record tab (WO-E42, merged); a "delete everything Erika knows" control (not asked for); `FEATURES.md`/`STATE.md`.

## Verification

This milestone's subject **is** the cold start, so verify it the way the gate does: `rm -rf` a disposable data directory, build, start, and walk in from nothing — in a browser, light and dark, phone viewport. **Prove which server answered you** (unusual port, assert a string unique to your build) and state the proof; a verification once hit another session's stale server and returned confident, wrong answers. Mutation-prove every new guard, especially the routing gate (make the profile check always-true and show a test go red). Before writing criterion 1, state the invariant and enumerate every path that could violate it — then ask what the opposite failure looks like, because it is a learner **locked out of their own populated app**, and that is worse than the defect being fixed.

Gates green plus tripwires. **Branch and push first**: empty commit and `git push -u origin feat/e46-first-run-and-progress` as your very first action.

## Exit report

Append here and **write it before returning**. Include the criterion-by-criterion status, the "What this deletes" list, the enumeration for criterion 1 with both directions tested, the re-proof of criterion 4's placement invariants, the mutation proofs, the proof of which server answered, and a plain description of how the progress surface looks in light and dark at phone width.

---

## Standing clause — product authority (operator directive, 2026-07-25)

Operator, on approving the v0.7 plan: *"aim for a really complete, usable, intuitive consumer product. Each one of those can have solutions — really make product calls, after thinking well and justifying them a little bit."*

**So the bar is not "the acceptance criteria are satisfied." The bar is that a person who has never seen this repository can use the thing end to end, without asking a question, and want to come back tomorrow.** If a criterion is ticked and that sentence is still false, the milestone is not done.

**You have product authority inside this milestone's scope, and you are expected to use it.** Choose the interaction. Choose the copy. Add the affordance the flow obviously needs and the work order failed to name. Resolve the ambiguities it left. Do not ship something technically correct but half-usable because the brief did not mention the missing half — a work order is the dispatcher's best guess at the product, written without having built it, and it is not scripture.

**The price of that authority is a short written justification.** In the PR body, a section that names each real product call: what you chose, what you rejected, and why. Two or three sentences each. If a call you want to make **contradicts an acceptance criterion**, that is allowed — say so explicitly, make the case, and implement your call; what is not allowed is silently narrowing the milestone, or leaving a criterion unmet without saying that you did.

**What is not yours to move**, because it is settled and re-litigating it wastes the run: the binding decisions — `DESIGN.md` in full, D-18 (correction-forward, error-once), D-19 (the knowledge model and the `known` gate), D-22 (speaker filtering local and recall-first), D-23 (register), D-24 (the calm habit layer and its ban list), E-17 (one findings truth), the money spine (reserve-before-call, the hard cap, spend recorded when a call resolves), and the rule that a shipped migration is never edited. Also not yours: **another milestone's scope.** A product call that belongs to a later milestone is a note in your exit report, not a diff — the dispatcher will route it.

**And subtraction still wins ties.** D-26 exists because this product acquired too many concepts, not too few. When two designs are close, ship the one with fewer things on screen.

---

## Amendment 1 — 2026-07-25 · **Day one must be calibrated, not generic.** (operator ruling)

E-44 answered its criterion 11 honestly and the answer exposed a seam this milestone must close. Its finding, verified live: what personalises a day is the syllabus rule the learner is at, their placement level, their due reviews and the tutor's targets — **but a learner on day one with no placement and no recordings gets a generic session: rule #1 at A1.**

The operator's ruling: *"day one should be based on the initial assessment. At least we should have some generic understanding of the person's level."*

They are right, and the machinery already exists — E-35's placement seeds recognition evidence and sets a level, and E-31's composer starts at the learner's edge. The only reason day one is generic is that **placement is skippable**, which is exactly what criterion 1 of this work order removes. So this is not new machinery; it is making the existing machinery unavoidable and then proving it reaches the first session.

9. **The first session is composed from the placement result, and this is tested end to end.** After onboarding completes, the learner's first daily session must reflect what the assessment just learned about them — their level, and a starting point at their edge rather than at A1 rule #1. **Acceptance:** drive onboarding as a learner who places at B1 or above, then immediately open the daily session and assert it is **not** the A1 opener. Assert the *positive* — that the session contains material at the placed level — because "no A1 rule" is satisfied by no lesson at all, and this repo has shipped that shape of vacuous assertion before. RETRO-003 proved this property once already ("a B1-placed learner gets no A1 grammar"); you are re-asserting it at a new seam, so reuse that test's shape if it fits.
10. **The spoken prompts must actually move the estimate.** Criterion 3 adds one or two spoken prompts so level is inferred from real **production**, not only recognition. State plainly in the PR body **what the spoken sample changes** about the placed level and the first session — and if the honest answer is "nothing yet, it only seeds evidence", say that rather than implying an influence the code does not have. An assessment step that costs the learner ninety seconds and changes nothing is a worse defect than not having it.
11. **A learner who declines or cannot speak is still calibrated.** No microphone, denied permission, no API key, or a learner who simply will not talk on first launch — the vocabulary check alone must still produce a usable level and a non-generic first session. The spoken prompts are an enrichment, never a gate. Test the declined path.

**Not in scope:** changing placement's scoring (`lib/placement/` stays as it is — the operator judged the vocabulary check good), or the composer's ordering (D-27 stands: syllabus backbone, recordings woven in). This amendment is about making sure the level the assessment produces actually reaches the learner's first day.

---

## Exit report — 2026-07-26

```
RESULT: done
PR:     feat/e46-first-run-and-progress
```

### Criterion by criterion

| # | Status | Evidence |
|---|---|---|
| 1 | met | Gate in `app/(app)/layout.tsx`, pure rule in `lib/onboarding/routing.ts`. Driven: 5 deep links (`/practice/session`, `/library`, `/settings`, `/progress`, `/practice/tutor`) → `/welcome`, light and dark. Populated: 7 paths → themselves. |
| 2 | met | `lib/onboarding/requirements.ts` + `components/onboarding/requirements-step.tsx`. Key **observed** (`hasAnalysisKey`), cap **read** ($50), automatic analysis and the worker stated as facts. Server-rendered, so no "Loading…" first paint. |
| 3 | met | Two takes: the spoken prompt (sent to the model, `POST /api/onboarding/spoken`) and the D-22 enrollment take (on-device, never uploaded). Both skippable. Scoring in `lib/placement/` byte-unchanged. |
| 4 | met | `lib/placement/scoring.ts` and `lib/knowledge/seed-placement.ts` untouched. Re-proved by the existing suites plus new cases: an unmeasurable run still records **no run, no evidence**; the rescued run seeds **grammar only, zero vocabulary**; supersession stays INSERT-only. |
| 5 | met | Driven: `[data-onboarding-enter]` → `/practice/session`, which rendered the C2 lesson. |
| 6 | met | `/progress` + `GET /api/progress`. Reached from the goal ring (`[data-open-progress]`) and from the Library. `/dev/knowledge`, its API and `lib/knowledge/inspector.ts` deleted. |
| 7 | met | Every figure is a row that exists. "Not started" where nothing was observed. `map` is `buildKnowledgeMap` verbatim — one notion of mastery. No trend, no return, no projection (asserted by regex over every sentence). |
| 8 | met | Phone viewport 390×844, light and dark, `prefers-reduced-motion`. One signature moment (the map settling). Green only in the map. Tabular numerals on every statistic. |
| 9 | met | `tests/onboarding-day-one.test.ts` asserts the **positive**. Driven live: placed C2 → first session = "C2 · Aspect in compound and progressive forms". |
| 10 | met | Answered plainly below. |
| 11 | met | `spokenBand: null` places from the check alone; tested and driven. |

### What this deletes

- `app/dev/knowledge/page.tsx`, `app/api/dev/knowledge/route.ts`, `lib/knowledge/inspector.ts`.
- `app/practice/placement/page.tsx` — folded into `/welcome`.
- The dismissible "Find your level" prompt.
- "Discover the requirements from an error message" — replaced by four sentences said once, up front.
- `AppShell` from the root layout (it now mounts only inside the gated group).

Net concepts: **down**. One new surface (`/progress`), two deleted (`/dev/knowledge`, `/practice/placement`), one deleted prompt.

### Criterion 1: the invariant, and the enumeration

**(a) FORCE** — while onboarding is incomplete, every navigable page resolves to `/welcome`.
**(b) NEVER TRAP** — while it is complete, *no* path is ever redirected there.

(b) is checked first and alone, because the opposite failure is a learner with a year of recordings bounced into a vocabulary check on every click. `onboardingComplete` is therefore a **disjunction** — marker OR placement run OR placement evidence OR any session — so a pre-E-46 database, a pre-v27 database and anyone who has ever recorded are all already "complete".

Paths that could violate (a), and how each is closed:

1. Typed URL / bookmark / deep link → the group layout renders before any page.
2. **Client-side `<Link>` navigation → this leaked, and driving found it.** With the gate in the ROOT layout, `curl -H "RSC: 1" /practice` returned **200 and the practice page**: the App Router caches the root layout, so it is not re-rendered for a navigation. Moving every page into `app/(app)/` fixed it — `/welcome` is outside the group, so entering the group is always a segment change and the layout always runs. The same request now returns `NEXT_REDIRECT;replace;/welcome;307` in the flight payload.
3. Tab bar / section nav → they live inside the group's layout, so they do not exist until the gate is passed (driven: 0 chrome elements on `/welcome`).
4. `/welcome` itself → exempt, or the redirect loops.
5. `/api/*`, `/_next/*` → never render a layout; exempted explicitly so the predicate is total.

A run refused as unmeasurable writes **no run and no evidence** by design, so the gate cannot key on the placement's writes alone — hence the explicit `onboarding_completed_at` marker in `settings` (no migration).

### Criterion 10: what the spoken sample actually changes

The two measurements are combined by one rule in `resolveLevel`: **the placed level is the higher of the two**, and an invalidated check contributes nothing at all.

- **Refused check (the yes-biased advanced learner).** The check produces no level; the spoken band becomes the level, seeds the sub-level grammar, and the first session composes at it. This is the escape RETRO-004 §1 left open. The recognised **words are still not seeded** — a "yes" from a response style carries no information whichever instrument levels the speaker.
- **Check measured lower than the speech.** The spoken band wins and the first session moves with it.
- **Check measured at or above the speech.** The level is unchanged. What the take still buys is real and is not nothing: the enrollment take makes E-36 speaker attribution work from day one.
- **No mic, denied permission, no key, over the cap, or a refusal to speak.** Nothing changes; the check places the learner (criterion 11).

It never lowers a level and it never rescues a check that was merely thin.

### Mutation proofs — 7 applied, 7 killed

| Mutation | Result |
|---|---|
| M1 `onboardingRedirect` never redirects | KILLED (2 failed) |
| M2 drop `if (complete) return null` — **the lockout** | KILLED (1 failed) |
| M3 `onboardingComplete` always true | KILLED (3 failed) |
| M4 placed level never reaches `seedPlacement` | KILLED (3 failed) |
| M5 spoken band ignored | KILLED (4 failed) |
| M6 progress invents its own green band | KILLED (2 failed) |
| M7 placement guesses counted as this week's movement | KILLED (1 failed) |

### Proof of which server answered

Port **41467** (unusual), `next start` on a production build, `ERIKA_DATA_DIR`/`ERIKA_DB_PATH` pointed at a scratch directory `rm -rf`'d immediately before. Every response carried the string unique to this build — the `/welcome` h1, `"Erika listens to you speak Italian, and teaches from what it hears."` — which exists on no other branch. The driver also opened the disposable database directly and reported `30786 lemmas seeded, no learner`.

### The look, at 390×844

**Light.** Page `#F5F5F7`, white 18px cards, black accent. `/welcome`: an uppercase caption, a 34/700 display line, four cards, one pill button; only the API-key row carries a mark (green check when found, hollow ring when not) because it is the only fact the server checked. `/progress`: caption → display heading → level line; three cards with 28px tabular numerals over "Words / Grammar / Sounds"; "This week"; "Still fossilized"; then the map as named 2-column cards, each with a hairline bar that tints green only through resolved slips. Driven cold it read "0 Words · 48 in progress", "0 Sounds · Not started", "Nothing has moved in the last seven days" — no green anywhere.

**Dark.** Page `#000`, cards `#1C1C1E`, ink `#F5F5F7`, hairline bars. Same layout, no washed-out text.

**Reduced motion.** All 5 map cells render; every transform degrades to a fade.

### Live verification (spend ≈ $0.018)

Six `gpt-audio-mini` calls, two of them through the real route and ledgered at **$0.00307** each, `state: 'committed'`, nothing left pending.

- Real Italian speech → `{"status":"measured","band":"B2"}`. The contract is validated against the live API, not a mock.
- A tone with no speech → the model replies in **prose**, not JSON. That is what the repo's one-shot strict-JSON repair exists for, and the call was not using it; `withRepair` was added and a test now pins the prose shape. Found only by making a real call.

### Tests changed

- `tests/learn-today-render.test.tsx` — the one-action count now strips the goal section. **Argued, not quiet:** E-46 makes the ring the way into progress; it adds no row, no label and no pixel, and everything outside the ring is still counted exactly as before. This is another milestone's test and the change is named here for the reviewer.
- `tests/two-tab-shell.test.ts`, `tests/session-notices.test.ts`, `tests/pronunciation-render.test.tsx`, `tests/pronunciation-route.test.ts` — href→file resolution now goes through `pageFileFor`, which knows about the route group. Behaviour unchanged.
- `tests/knowledge-yield.test.ts` — the dev-inspector block removed with the inspector.

### Unverified, named plainly

- **The microphone paths were never exercised by a human.** Both recorders were driven only as far as "Skip"; `getUserMedia` cannot run headless. The enrollment take and the spoken take are wired to existing, shipped components (`EnrollmentRecorder`, `useRecorder`) but the round trip record → `/api/onboarding/spoken` → band was proved by `curl` with a file, not by speaking into the browser.
- **The B2 verdict came from synthetic TTS**, not a real learner. It proves the contract and the parse, not the calibration of the band.
- **No labelled Italian corpus exists**, so the spoken band is the model's impression, coarse by design, and it is only ever allowed to raise.
- `/welcome` re-run by a placed learner supersedes their placement — correct and stated on screen, but not driven end to end a second time.
- Three pre-existing unused-import lint warnings in `lib/analysis/audio-model.ts` predate this branch (verified by stashing); left alone as out of scope.
