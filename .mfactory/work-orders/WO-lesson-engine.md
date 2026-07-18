# WO-lesson-engine — E-6 Micro-lessons (part 1 of 2): pattern → lesson generation, rewrite grading & mastery

Target repo: github.com/immaculatecross/erika · Branch: `feat/lesson-engine` · Diff cap: ~400 lines soft (excl. lockfile & fixtures). If it can't fit, report `split` at [text client + generation + parsing + smoke] then [pattern derivation + grading + mastery + budget].

**Milestone context.** Part 1 of 2 of E-6 (Micro-lessons), fourth milestone of v0.2. This part is the **backend engine**: derive recurring error patterns from findings, generate a short grammar lesson with exercises for a pattern (via a text model), grade a free-text rewrite (via the model), and track per-pattern mastery — all inside the existing budget. **Part 2 (WO-lesson-ui) is the interactive lesson-taking UI.** This is the second milestone that **spends real money** (text-model calls) — reuse E-4's money-safety exactly; the money criteria matter as much as the pedagogy.

## What already exists (reuse)

- `lib/analysis/findings.ts`: `Finding` (`category`, `severity`, `quote`, `correction`, `explanation`, `sessionId`); `listAllFindings(db)`.
- **Money-safety from E-4 — reuse, do not fork:** `lib/analysis/budget.ts` (`monthKey`, `monthToDateSpend`, `wouldExceedBudget`, `recordSpend`), `lib/analysis/rates.ts` (`RATES`, `callCost`), Settings `monthlyBudgetUsd`. The `spend_ledger` is shared — text-model calls record into the SAME ledger and count against the SAME monthly cap.
- The isolated-client + structured-parse + mock-in-tests + one-documented-smoke pattern from `lib/analysis/audio-model.ts` / `cascade.ts` — mirror it for text.

## Pinned technical decisions (do not substitute without reporting `blocked`)

- **Text model, isolated + mocked:** lesson generation and rewrite grading call an OpenAI **text** chat model behind one thin client (e.g. `lib/lessons/text-model.ts`) with a typed interface, requesting **structured JSON** (reuse the balanced-`{…}` extraction lesson learned in E-4 — the models may reply with prose/fenced JSON). ALL generation/grading/pattern logic is unit-tested against a **mock** client; no CI test makes a real call. Read `OPENAI_API_KEY` from env; never log/commit it. Pick the text model id, document it; add its rate to `rates.ts` (**token-based** — text bills on tokens, not audio-minutes; extend the cost path accordingly).
- **Budget cap (reuse E-4):** before every billable call (generate or grade) check `wouldExceedBudget(monthToDateSpend + thisCost, monthlyBudgetUsd)`; if it would exceed, refuse truthfully ("monthly budget reached") and make no call. Record every real call's cost via `recordSpend` into the shared ledger. Cache/reuse a generated lesson so re-opening a pattern's lesson does not re-generate/re-bill.
- **Pattern derivation (pure, explainable):** a pattern is a recurring error grouping derived from the user's findings — for v1, **per category with ≥ 3 findings** counts as a recurring pattern (document the threshold; finer model-clustering is a future upgrade). The generated lesson targets that pattern using the user's actual findings in it as source material.
- **Not a long job:** a lesson generation and a rewrite grade are each ONE quick model call — do them at request time behind a budget check, not via the ingest/analysis worker. No new worker.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. Generation/grading/parse/budget logic is tested against a **mock** client + fixtures; exactly ONE real-API smoke proves live wiring.

1. **Pattern derivation.** A pure function derives patterns from findings — a category with ≥ 3 findings is a pattern; fewer is not; each pattern carries its example findings. (Test: fixtures at/below/above threshold.)
2. **Lesson generation parses & persists.** A model JSON response parses into a lesson: a short explanation + a list of exercises typed as `multiple_choice` (prompt, options[], answerIndex), `fill_in` (prompt, answer), and `rewrite` (prompt, target). Persisted (migration v7: `lessons`, exercises as rows or JSON, keyed to the pattern). Malformed/partial output → truthful error, no partial persist, no crash. (Test: good fixture → typed exercises; malformed → clean rejection.)
3. **Rewrite grading.** Grading a user's rewrite against the target returns `{ correct: boolean, feedback: string }` parsed from the model; malformed → truthful error. (Test with mock: correct and incorrect fixtures parse; malformed handled.)
4. **Budget cap + ledger (reuse E-4).** Generation and grading each check the shared monthly cap before billing and refuse truthfully when it would be exceeded (no call, no over-cap ledger row); every real call records its actual token cost into `spend_ledger`; a re-opened (cached) lesson makes zero new calls. (Test: tiny budget + near-cap spend → generate/grade refuse before billing; cached lesson → 0 calls.)
5. **Mastery.** A per-pattern mastery value is stored and updated on lesson completion (the update rule is exercised here; the completion trigger UI is part 2). (Test: completing a lesson with a given score updates that pattern's mastery per the documented rule.)
6. **One real-API smoke, documented.** Exactly ONE real generate + ONE real grade call, on one small pattern, proving live wiring + parsing; record outcome + rough cost in the PR. **If the model/endpoint is unavailable, do NOT thrash — stop and report `blocked` with the exact API error.** Keep real spend to a few cents.

## Files and constraints

- **Migration v7** (append-only; never edit v1–v6): `lessons` (pattern key, explanation, exercises, created_at), `lesson_mastery` (pattern key, mastery, updated_at). FK/keys coherent; document how a pattern key is formed.
- **New modules** (each < 500 lines) under `lib/lessons/`: `text-model.ts` (isolated client), `patterns.ts` (pure derivation), `generate.ts`, `grade.ts`, `lessons.ts` (typed data layer), `mastery.ts`. Reuse `lib/analysis/budget.ts` + `rates.ts` (extend rates with the text model's token rate). **API routes (Node):** generate-lesson-for-pattern (budget-checked), grade-rewrite (budget-checked). No UI here.
- **Secrets:** `OPENAI_API_KEY` from env only; never printed/committed.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; the `gates` check must pass **with no network** (mock client; real smoke is local, documented in the PR).

## Out of scope (do not touch)

- **The E-6b lesson-taking UI** (lesson list, MC/fill-in/rewrite runner, feedback display, mastery display). A minimal trigger for your own verification is fine; the interactive surface is part 2.
- The analysis/ingest/capture/flashcards/phrasebook/archive engines and contracts (reuse read-only); editing shipped migrations.
- E-12 (editor's letter); any audio-model change.

## Milestone ritual (this PR)

E-6 completes in part 2, so set **FEATURES.md E-6 `next → building`** (not `done`; don't touch E-12). Leave STATE.md accurate (a one-line "E-6 in progress: lesson engine landed" note is fine). Full regen + the v0.2-order flip belong to part 2.

## PR description must state

What changed per area; the **exact commands** proving each criterion (pattern threshold, parse/no-partial-write, budget-refuse-before-billing, cached-no-rebill); the **documented real-API smoke** result + rough cost; and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       feat/lesson-engine (URL added on push)
Changed:  - Migration v7: lessons + lesson_mastery tables (append-only; pattern-keyed, cached).
          - rates.ts: token-based TEXT_MODEL (gpt-4.1-mini), textCallCost, estimateTokens; BillableModelId; recordSpend widened to it (same spend_ledger, same cap).
          - lib/lessons/: patterns.ts (pure derivation, >=3/category), text-model.ts (isolated OpenAI text client + balanced-{...} JSON extractor, mocked in tests), billing.ts (shared pre-call budget gate), generate.ts (+ pure parseLessonResponse), grade.ts (+ pure parseGradeResponse), lessons.ts (typed data layer, one cached lesson/pattern), mastery.ts (EMA rule).
          - Routes: GET /api/lessons/patterns; budget-checked POST /generate + /grade; POST /complete.
          - FEATURES E-6 next->building; STATE.md note. NO lesson-taking UI (E-6b).
Verified: npm run lint / typecheck / build all green; npm run test = 201 passed (35 files), incl. 6 new lesson suites (27 tests):
          - lessons-patterns: threshold at/below/above, canonical order, key round-trip.
          - lessons-parse: good lesson -> 3 typed exercises; fenced/prose tolerated; 8 malformed/partial cases rejected whole; grade correct/incorrect/malformed.
          - lessons-engine (mock client): generate persists+bills shared ledger, cached -> 0 calls + ledger unchanged, malformed -> no persist/no spend, budget refuses before billing (no call/no row), audio spend counts against text cap, grading bills, grade budget-refuse.
          - lessons-mastery: EMA rule + clamp, persist + reload.
          - lessons-schema: v7 tables, exercise JSON round-trip, UNIQUE pattern_key.
          - lessons-route: patterns list, generate 404/402, grade 400/402, complete 200/400 (all no-network).
          Real-API smoke (ONE generate + ONE grade, gpt-4.1-mini, local, key from .env.local): generate parsed into 5 typed exercises (multiple_choice/fill_in/rewrite); grade parsed {correct:false, feedback:...}; 2 ledger rows; total spend ~$0.00072 (well under a cent). Live wiring + parsing confirmed.
Risks:    - PR exceeds the ~400-line soft cap (engine + tests). The WO's fallback split would ship a billable path without its budget cap, so it was kept cohesive; every billable path is capped and tested.
          - Text-model rates and the model id (gpt-4.1-mini) are founding-era approximations in rates.ts (the single knob); recalibrate against real usage.
          - Pre-call cost is a safe upper bound (worst-case max_tokens), so it can refuse slightly early near the cap — never bills over.
          - Smoke ran with default targetLanguage Italian over English fixtures, so grade feedback referenced Italian; cosmetic, parsing unaffected.
Blocker:  none
```
