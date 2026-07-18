# WO-lesson-ui — E-6 Micro-lessons (part 2 of 2): the interactive lesson UI

Target repo: github.com/immaculatecross/erika · Branch: `feat/lesson-ui` · Diff cap: ~400 lines (excl. lockfile). Completes E-6.

**Milestone context.** Part 2 of 2 of E-6, and it **completes the milestone**. Part 1 (the lesson engine: pattern derivation, model generation + rewrite grading, mastery, budget) is **already merged on `master`**. This part is the interactive UI that lets the user take a lesson. Reuse the engine; do not change its model behavior.

## What already exists (reuse)

- Routes: `GET /api/lessons/patterns` (patterns with ≥3 findings), `POST /api/lessons/generate` (budget-checked; returns/reuses the cached lesson, or 402 when the cap is reached), `POST /api/lessons/grade` (rewrite → `{ correct, feedback }`, budget-checked), `POST /api/lessons/complete` (records a score → updates mastery).
- `lib/lessons/lessons.ts`: `Exercise` (`multiple_choice` {prompt, options[], answerIndex}, `fill_in` {prompt, answer}, `rewrite` {prompt, target}), `Lesson`, `getLessonByPattern`. `lib/lessons/patterns.ts`: `Pattern`, `patternKey`, `derivePatterns`. `lib/lessons/mastery.ts`: `getMastery`, `MASTERY_ALPHA`. `lib/lessons/billing.ts`: `budgetReached`.
- The existing Practice screen (`app/practice/page.tsx`) — the flashcard due-queue. The shell/sidebar, design tokens, the empty-state component.

## Objective

The user works on a recurring error pattern. From **Practice** (a small additive "Work on a pattern" section — reuse the existing sidebar, do NOT add a 7th nav item), they open a **lessons list** of their patterns (each with its finding count and current mastery). Opening one shows a **short grammar lesson** (a generated-or-cached explanation) and steps through its **interactive exercises**: multiple-choice (pick → immediate correct/incorrect), fill-in (type → checked against the answer), and rewrite (type → **model-graded feedback**). Finishing the lesson **records a completion score and updates the pattern's mastery**, shown to the user. If the monthly budget is reached, generating/grading is refused with a truthful message — never a broken screen.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Lessons list under Practice.** A `/practice/lessons` route (reachable from the Practice screen) lists the user's patterns (from `GET /api/lessons/patterns`) with each pattern's finding count and mastery; a quiet empty state when there are no qualifying patterns. The flashcard flow on `/practice` remains intact. (Test: seeded patterns render with mastery; zero → empty; the cards due-queue still works.)
2. **Take a lesson — generate/cached + budget gate.** Opening a pattern shows its lesson (generated on first open, reused when cached — no re-generate); when the budget is reached the screen shows a truthful "monthly budget reached" state and does not error. (Test/e2e: a seeded cached lesson renders WITHOUT a model call; a budget-reached state renders truthfully.)
3. **Interactive exercises.** Multiple-choice marks the selected option right/wrong; fill-in checks the typed answer (case/whitespace-insensitive is fine, document it); rewrite submits to `POST /api/lessons/grade` and shows the returned `correct` + `feedback`. Each exercise's result is visible before advancing. (Test/e2e: MC and fill-in resolve deterministically from a seeded lesson; the rewrite path renders a stubbed grade response — do NOT call the real model in tests.)
4. **Completion updates mastery.** Finishing the lesson posts a score to `POST /api/lessons/complete`; the pattern's mastery updates per the engine rule and the new value is shown. (Test: complete → mastery changed and reflected in the list.)

## Files and constraints

- **UI:** `app/practice/lessons/page.tsx` (list), `app/practice/lessons/[patternKey]/page.tsx` (the runner), small exercise components, an optional `lib/use-lesson.ts` client hook. Add a minimal "Work on a pattern" entry to `app/practice/page.tsx` — additive only; **do not restructure or regress the flashcard due-queue**. If the `Exercise`/`Lesson` types pull server-only imports, add a client-safe view module (as prior milestones did with `*-view.ts`).
- **No real model calls in tests/e2e:** seed a cached lesson row directly for e2e (so no `generate` call fires) and stub/intercept the grade response; MC/fill-in are deterministic. The `gates` check stays green with no network.
- **No engine changes:** do not modify generation/grading/mastery/budget logic or migrations. Read/drive the existing routes only (a client-safe type extraction is the only permitted lib touch).
- **DESIGN.md binding:** calm lesson layout, black/white accent, green/red only for correct/incorrect and mastery meaning, tabular numerals; one exercise in focus at a time; reduced-motion respected.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green. Playwright specs use a fresh/isolated DB per run.

## Out of scope (do not touch)

- The lesson engine (E-6a: generation, grading, mastery rule, budget, migrations) beyond a client-safe type re-export.
- The flashcard drill/scheduler, and all other engines/contracts (reuse read-only).
- E-12 (editor's letter); any new top-level nav item; any audio-model change.

## Milestone ritual (this PR completes E-6)

Flip **FEATURES.md E-6 `building → done`** and **E-12 `backlog → next`** (E-12 is the last v0.2 milestone per D-15; leave E-8/E-10 `backlog`), and **regenerate STATE.md** (one screen) to reflect that Micro-lessons shipped (patterns → generated lessons with interactive, model-graded exercises, mastery tracked) and E-12 (editor's letter) is next — the v0.2 finale. Keep the D-15 standing order truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (especially the budget-reached state and that no real model call fires in tests), what they proved, and risks. Conventional-Commit title.

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/18  (feat/lesson-ui → master)
Changed:
  - lib/lessons/lessons-view.ts — client-safe Exercise/Lesson types + EXERCISE_TYPES + pure helpers (checkFillIn, lessonScore, masteryPercent); lessons.ts re-exports them (the only engine touch, no behaviour change).
  - app/practice/lessons/page.tsx — lessons list: patterns from GET /api/lessons/patterns with finding count + green mastery meter; quiet empty state below threshold.
  - app/practice/lessons/[patternKey]/page.tsx + components/lesson-runner.tsx + lib/use-lesson.ts — the runner: generate-or-cached open (POST /generate, 402→truthful budget state), explanation, one exercise in focus at a time — MC (green/red), fill-in (case/whitespace-insensitive), rewrite (POST /grade model verdict); finish posts score to POST /complete and shows updated mastery.
  - app/practice/page.tsx — additive "Work on a pattern" link in the due and empty states; flashcard due-queue untouched; no 7th nav item.
  - tests/lessons-view.test.ts + e2e/lessons.spec.ts — pure-helper units and the full UI e2e (cached open = no model call, MC/fill-in deterministic, rewrite grade stubbed, completion→mastery, budget-reached).
  - FEATURES.md (E-6 building→done, E-12 backlog→next) + STATE.md (regenerated); this work order.
Verified:
  - npm run lint / npm run typecheck — clean.
  - npm run test — 36 files / 205 unit tests pass, no network.
  - npm run build — full production build; /practice/lessons (static) + /practice/lessons/[patternKey] (dynamic) emitted.
  - npx playwright test lessons.spec — 5/5: list renders count+mastery, empty below threshold, /practice due-count intact (regression); a seeded CACHED lesson opens with NO model call (explanation verbatim, lessons row stays 1); MC right/wrong, fill-in typed answer, rewrite grade stubbed (no real model); completion → mastery 50% shown and reflected in the list; budget-reached renders truthfully with nothing generated.
  - npx playwright test shell.spec (6/6) / flashcards.spec (3/3) / flashcards-manage.spec (3/3) in isolation — sidebar still 6 nav items, due-queue + card browser intact.
Risks:
  - Product code exceeds the ~400-line soft cap: the lesson UI is one indivisible feature (three exercise interaction types + four runner phases); splitting would ship a broken milestone (WO forbids). Every file is focused and under the 500-line hook limit.
  - Running several Playwright spec files together against the shared throwaway DB flakes non-deterministically on this machine — PRE-EXISTING (reproduced with baseline specs, no lessons.spec) and outside the CI `gates` check (lint/typecheck/test/build/tripwires). Each spec passes in isolation.
Blocker:  none
```
