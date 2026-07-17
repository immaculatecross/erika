# WO-flashcards-drill — E-5 Flashcards (part 1 of 2): cards from findings, SM-2 & the practice drill

Target repo: github.com/immaculatecross/erika · Branch: `feat/flashcards-drill` · Diff cap: ~400 lines (excl. lockfile)

**Milestone context.** Part 1 of 2 of E-5 (Flashcards), the last milestone of **v0.1**. This part builds the drill loop: every analysis finding becomes a deduplicated card, the Practice screen shows the due queue, and a full-screen practice session flips cards and grades them through SM-2 scheduling. **Part 2 (WO-flashcards-manage) adds the card browser (suspend/delete) and CSV export** and completes the milestone. Do not build those here.

## What already exists (reuse, don't reinvent)

- `lib/analysis/findings.ts`: `Finding` = `{ id, sessionId, contentHash, quote, correction, category, explanation, severity, startMs, endMs }`; `listFindings(db, sessionId)`. Cards are made from findings.
- Migrations append-only in `lib/migrations/index.ts` — latest is **version 4**; add **version 5**.
- The typed data-layer style (`lib/settings.ts`, `lib/segments.ts`), the DB singleton, the design tokens, Motion helpers (`lib/motion.ts`, `lib/use-reduced-motion.ts`), and the Practice route empty state (`app/practice/page.tsx`).

## Objective

Every finding becomes a flashcard — **front: your phrase in its context (the finding's `quote`); back: the correction + why (`correction` + `explanation`)** — generated once per finding (deduplicated). The **Practice** screen shows how many cards are due and lets you start. A **full-screen practice session** presents one card at a time; pressing space (or clicking) flips it with a 3D flip (DESIGN's signature "practice card's 3D flip"); grading **Again / Hard / Good / Easy** (keys 1–4) advances the card through **SM-2** scheduling, persists it, and moves to the next due card; when the queue empties, a quiet done state. Everything is keyboard-drivable.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Cards from findings, deduplicated.** Generating cards creates exactly one card per finding (front = `quote`, back = `correction` + `explanation`, carrying the finding's `startMs`/session for later jump-to-audio and the category/severity), and is idempotent — re-running adds no duplicates for findings that already have a card. (Test: N findings → N cards; second run → still N.)
2. **SM-2 scheduling (pure + persisted).** A pure scheduler `lib/srs.ts` maps a grade (Again/Hard/Good/Easy) to updated `ease`, `intervalDays`, `repetitions`, and next `due`, per the SM-2 algorithm (Again resets the interval and reduces ease within bounds; Easy lengthens most; ease floored at 1.3). Grading a card persists the new schedule. (Test: unit-test the scheduler across all four grades from fresh and from a review state; assert monotonic interval growth on repeated Good/Easy and reset on Again.)
3. **Practice due queue.** `/practice` shows the count of due cards (due `<=` now, not suspended) and a start affordance; with none due it shows a quiet empty state. The due selection is correct and ordered (most overdue first, or a documented order). (Test: seed cards with past/future due + a suspended one → only the due, non-suspended appear.)
4. **Full-screen practice with flip + grading + keyboard.** A full-screen session shows a card front; **space** or click flips to the back with a 3D flip (transform-only, spring; `prefers-reduced-motion` degrades to a crossfade — no rotation); keys **1–4** grade Again/Hard/Good/Easy, which persists the SM-2 update and advances to the next due card; the session ends with a done state when the queue is empty. (Test: an e2e that drives the session by keyboard — flip, grade, advance — and asserts the card's schedule changed and the next card shows; a unit/e2e check that reduced-motion uses the crossfade variant.)

## Files and constraints

- **Migration v5** (append-only; never edit v1–v4): a `cards` table — `id`, `finding_id` (unique, FK → findings, `ON DELETE CASCADE`), `session_id`, `front`, `back`, `category`, `start_ms`, SM-2 fields (`ease` REAL, `interval_days` INTEGER, `repetitions` INTEGER, `due` TEXT, `last_grade` TEXT), `suspended` INTEGER default 0, `created_at`. (The `suspended` column is written here but its UI is E-5b.)
- **New modules** (each < 500 lines): `lib/srs.ts` (pure SM-2 — no DB), `lib/cards.ts` (typed data layer: `generateCards`, `listDueCards`, `getCard`, `gradeCard`; plus `suspend`/`delete` helpers E-5b will surface). API routes (Node): `POST /api/cards/generate`, `GET /api/cards?due=1`, `POST /api/cards/[id]/grade`.
- **When cards are generated:** idempotently — e.g. on analysis completion and/or on demand from Practice. Keep generation a pure-ish server function so it's unit-testable; do not couple it to the UI.
- **UI:** `app/practice/page.tsx` (due count + start, replacing the empty state when cards exist); a full-screen practice runner (e.g. `app/practice/review/page.tsx` or a full-screen component) with `components/flashcard.tsx` (the 3D flip). DESIGN.md binding — calm, black/white accent, severity via the semantic scale only where it carries meaning, tabular numerals; the flip is a signature moment (budget quality; reduced-motion → crossfade). The grade buttons have the press-down active state DESIGN names.
- **Tests/e2e:** if you add Playwright specs, give them a **fresh/isolated DB per run** (a prior review flagged the shared `.playwright/e2e.db` causing dirty-state false failures) — don't rely on a pre-existing DB.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; the `gates` check must stay green (no network — cards come from seeded findings, not a live model).

## Out of scope (do not touch)

- **The card browser (suspend/delete UI) and CSV export** — that is WO-flashcards-manage (part 2). You may add the `suspend`/`delete` data-layer helpers, but no browser UI or export here.
- Any change to the analysis/ingest/capture engines or their contracts (reuse read-only; `Finding` is fixed).
- All v0.2 features (E-6/E-7/E-9/E-11/E-12).

## Milestone ritual (this PR)

E-5 completes in part 2, so set **FEATURES.md E-5 `next → building`** (not `done`). Leave STATE.md accurate; a one-line "E-5 in progress: drill loop landed" note is fine. Full regen + the v0.1-complete / v0.2-next flip belong to part 2.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (SM-2 behavior, dedup, keyboard drill), what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/12  (branch feat/flashcards-drill → master)
Changed:
  - Migration v5: `cards` table — one row per finding, `finding_id` UNIQUE (FK → findings, ON DELETE CASCADE), session_id/front/back/category/start_ms, SM-2 fields (ease/interval_days/repetitions/due/last_grade), suspended default 0. Append-only; v1–v4 untouched.
  - lib/srs.ts — pure SM-2 scheduler (no DB): Again resets streak + interval (due now) and drops ease; Hard/Good/Easy grow the interval 1 → 6 → round(prev×ease) with ease updated first so Easy lengthens most; ease floored at 1.3.
  - lib/cards.ts — typed data layer: generateCards (idempotent, INSERT OR IGNORE on the UNIQUE key), listDueCards (due<=now, not suspended, most-overdue-first), countDueCards, getCard, gradeCard (persists the SM-2 result + concrete due), plus suspendCard/deleteCard for E-5b. Back-text helpers moved to the client-safe lib/cards-view.ts (CardView, GRADES, grade guards) so the flip card imports no node:crypto.
  - Routes (Node): POST /api/cards/generate, GET /api/cards?due=1, POST /api/cards/[id]/grade (404/400 guards).
  - UI: app/practice/page.tsx now generates cards on arrival and shows the due count + Start; app/practice/review/page.tsx is the full-screen keyboard runner; components/flashcard.tsx is the signature 3D flip (transform-only spring; reduced-motion → crossfade, no rotation). Grade buttons get the press-down active state.
  - Ritual: FEATURES.md E-5 next→building; STATE.md notes the drill loop landed (part 1 of 2).
Verified:
  - npm run lint · npm run typecheck → clean.
  - npm run test → 127 passed (19 new). SM-2 (tests/srs.test.ts): all four grades from fresh + a review state, Easy>Good>Hard interval ordering, monotonic growth over repeated Good/Easy, ease pinned at 1.3 under repeated Again. Dedup (tests/cards.test.ts): 3 findings → 3 cards, second generate → 0 / still 3; due-queue selection excludes suspended + future and orders most-overdue-first; grade persists + drops the card from due; session delete cascades cards. Routes (tests/cards-route.test.ts): generate idempotent, due view is the 4-field client shape, grade persists + 404/400.
  - npx playwright test flashcards → 3 passed. Drove the session by keyboard: Space flips (data-flipped true), key 3/4 grades and advances to the next card (data-card-index 0→1, a different front shows), queue empties → done state; asserted from the DB that both cards changed (last_grade set, due > now). Separately: due/suspended/future filtering; reduced-motion emulated → flashcard data-motion="crossfade" and stays crossfade across a flip.
  - npm run build → succeeds (all /api/cards/* and /practice/* routes emitted).
Risks:
  - PR size ~1279 lines (≈783 product / ≈496 test), over the ~400 guide. Part 1 is already the dispatcher's split of E-5; the migration + scheduler + data layer + routes + runner + flip are one indivisible drill loop (a finer split ships a dead half-feature). Reviewable, but larger than target.
  - Pre-existing e2e flake: analysis-ui (and sometimes ingest-ui) live-polling tests fail ~1-in-25 under load — reproduced with this spec NOT loaded (analysis-ui --repeat-each 5), so it is an E-3/E-4 race, not this change. CI's `gates` job runs lint/typecheck/test/build/tripwires only (no Playwright), so it does not gate the merge.
  - Cards are generated on demand when Practice is opened (idempotent), not on analysis completion; a session analyzed while Practice is never visited yields no cards until the next visit. Acceptable for v0.1; a worker-time hook is a later option.
Blocker:  none.
```
