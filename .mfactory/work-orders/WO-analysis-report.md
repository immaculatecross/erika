# WO-analysis-report — E-4 Analysis (part 2 of 2): pre-run estimate, live progress & the findings report

Target repo: github.com/immaculatecross/erika · Branch: `feat/analysis-report` · Diff cap: ~400 lines (excl. lockfile)

**Milestone context.** Part 2 of 2 of E-4, and it **completes the milestone**. Part 1 (the cascade engine, findings persistence, rates/cost/spend-ledger/budget-cap) is **already merged on `master`**. This part is the **report UI** plus one small backend hardening (below). Reuse the engine; do not change the cascade's model behavior.

## What already exists (reuse, don't reinvent)

- `lib/analysis/findings.ts`: `listFindings(db, sessionId) → Finding[]` (fields: `quote`, `correction`, `category ∈ {grammar,vocabulary,phrasing,idiom,pronunciation}`, `explanation`, `severity ∈ {high,medium,low}`, `startMs`, `endMs`, `contentHash`).
- `lib/analysis/cascade.ts`: `AnalysisState = queued|processing|done|failed|halted`, `getAnalysisJobBySession`, `getActiveAnalysisJob`, `enqueueAnalysis`, `pendingSegments`.
- `lib/analysis/cost.ts`: `estimateCost` (+ `CostEstimate`). `lib/analysis/budget.ts`: `monthToDateSpend`, `wouldExceedBudget`.
- API: `GET /api/sessions/[id]/analysis/estimate` (pre-run cost) and `POST /api/sessions/[id]/analysis` (start; re-checks budget server-side, 402 when the cap is reached). The worker drains analysis jobs.
- Reuse the E-3b live-polling pattern (`lib/use-ingest.ts`) and the audio player + Range route for jump-to-audio (E-2/E-3b).

## Objective

On the session detail page (below the ingest section), the user can analyze the session and read the result. Pressing **Analyze** first shows the **pre-run cost estimate** (from the estimate endpoint) and the remaining monthly budget, then a confirm starts the run; if the budget is already reached the UI says so truthfully and does not start. While the analysis runs, a restrained **progress indicator (the DESIGN "analysis progress orb" — this is its home)** advances **without a reload**. When done, a **report** shows **per-category counts** and the findings, each **expanding in place** to reveal quote → correction → why, with its severity, and a **jump-to-audio** control that seeks the player to the finding's timestamp. A `halted` (budget) or `failed` run shows its truthful reason; a done run with zero findings says so quietly.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Pre-run estimate + budget gate.** Pressing Analyze fetches and shows the estimated cost and remaining budget before anything runs; confirming issues the POST. When the cap is already reached, the UI shows a truthful "monthly budget reached" state and never starts a run. (Test: the estimate endpoint drives the shown figure; a near-zero remaining budget shows the halted/blocked state and no job is enqueued.)
2. **Live progress, no reload.** While the analysis job is `queued`/`processing`, the page polls and shows the stage/progress via the progress orb, updating without a manual reload; polling stops on a terminal state (`done`/`failed`/`halted`) and clears on unmount. (Test: seed a job and advance `processing → done`; assert the UI updates without reload and polling stops.)
3. **Report: counts, expand-in-place, jump-to-audio.** A `done` session shows per-category counts across the five categories; each finding expands in place (layout animation) to show quote, correction, explanation, and severity; a jump-to-audio control seeks the reused audio player to the finding's `startMs`. (Test: given fixture findings, counts are correct; expanding one reveals its detail; the jump control drives the player's currentTime to the finding start.)
4. **Truthful terminal states.** `halted` shows a truthful budget message; `failed` shows its stored error; `done` with zero findings shows a quiet, specific "no errors found" line (DESIGN copy — never "Great!"). (Test each.)
5. **Money-safety hardening (closes the part-1 review advisory).** Make the spend record and the findings/witness write **atomic**: `recordSpend` and `persistSegmentFindings` for a segment must commit in a **single transaction**, so a crash between them cannot leave a charge without its completion witness (which would re-bill that segment on resume). (Test: simulate a failure between the two writes and assert either both or neither persisted — no charge without witness.)

## Files and constraints

- **New read route:** a `GET` for analysis status + report on `app/api/sessions/[id]/analysis/route.ts` (the file already has POST) or a sibling route — returning `{ state, stage, progress, error }`, the findings, and per-category counts. GET only; no new mutation surface beyond the existing start.
- **UI:** extend `app/sessions/[id]/page.tsx`; new components e.g. `components/analysis-progress.tsx` (the orb — transform/opacity, spring), `components/analysis-report.tsx` (counts + expandable findings + jump-to-audio). A `lib/use-analysis.ts` polling hook mirroring `use-ingest.ts` (poll only while non-terminal; clear on unmount).
- **Backend hardening (criterion 5):** the atomic `recordSpend`+`persistSegmentFindings` change in `lib/analysis/*` — minimal, with a test. Do not otherwise change the cascade's model calls, prompts, or rates.
- **DESIGN.md is binding.** The analysis orb is a named signature moment — budget quality (real progress-driven, spring, 60fps, reduced-motion degrades to a static state). Findings expand in place (layout animation). Severity uses the semantic scale (red high, orange medium, green low/resolved — D-8/D-14); black/white accent otherwise; tabular numerals for counts and costs.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; the `gates` check must stay green with NO network (reuse the mocked client / seeded rows in tests — no real API calls).

## Out of scope (do not touch)

- Any change to the cascade's model behavior, prompts, or rates (part 1 is fixed) beyond the criterion-5 atomicity fix.
- Flashcards from findings (E-5) and all v0.2 features.
- The capture/ingest surfaces and their contracts (reuse read-only).

## Milestone ritual (this PR completes E-4)

Flip **FEATURES.md E-4 `building → done`** and **E-5 `backlog → next`**, and **regenerate STATE.md** (one screen) to reflect that Analysis shipped (the cascade produces cached, budgeted findings; the session page shows the pre-run estimate, live analysis progress, and a per-category findings report with jump-to-audio) and E-5 Flashcards is next. **In the STATE standing order, reflect D-15:** the unattended mission continues past v0.1 (E-1…E-5) into v0.2 (E-7, E-9, E-11, E-6, E-12) — so a cold session keeps going. Keep it truthful.

## PR description must state

What changed per area, the **exact commands** used to verify each criterion (including the no-reload live update and the criterion-5 atomicity test), what they proved, and risks. Conventional-Commit title.

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/11  (feat/analysis-report → master)
Changed:
  - fix(analysis): recordSpend now commits INSIDE persistSegmentFindings' single
    transaction (criterion 5) — runDeep returns its spend entry rather than
    recording it; both cascade stages persist spend + findings + witness atomically,
    so a crash between billing and its witness can never re-bill a segment.
  - feat: GET /api/sessions/[id]/analysis returns { state, stage, progress, error }
    + findings + per-category counts (GET-only; no new mutation surface).
  - feat: lib/analysis-view.ts (client-safe shape + pure categoryCounts) and
    lib/format.ts formatUsd.
  - feat: lib/use-analysis.ts polling hook (mirrors use-ingest; polls only while
    non-terminal, clears on unmount, refresh() resumes after a start).
  - feat: components/analysis-progress.tsx (the orb — spring scale, breathing
    opacity, reduced-motion→static), analysis-report.tsx (per-category counts +
    expand-in-place findings + jump-to-audio), analysis-panel.tsx (estimate/confirm/
    budget-gate/terminal-state orchestration); wired into app/sessions/[id]/page.tsx
    reusing the audio player via a shared seekToMs.
  - Milestone ritual: FEATURES.md E-4 building→done, E-5 backlog→next; STATE.md
    regenerated (E-4 shipped both parts; standing order reflects D-15 v0.2 scope).
Verified:
  - npm run test → 108 unit tests pass (8 new). analysis-atomicity proves the
    criterion-5 all-or-nothing (forced findings-write failure rolls the charge back:
    monthToDateSpend 0, no witness; both persist on success). analysis-view proves
    categoryCounts + formatUsd. analysis-route adds GET-report coverage.
  - npm run build → full production build succeeds (catches bundler errors tsc misses).
  - npx playwright test analysis-ui → 5 e2e pass on the real page: estimate figure
    from the endpoint + confirm enqueues exactly one job; capped month shows
    budget-reached and enqueues nothing; processing→done updates with NO reload
    (window mark survives) and polling freezes on terminal; per-category counts,
    expand-in-place, and jump-to-audio drives audio.currentTime to the finding start;
    halted/failed/zero-findings each render their truthful line.
  - npx playwright test → 20/20 pass (no regression). typecheck + lint clean.
  - No network / no real OpenAI calls — mocked client + seeded rows throughout.
Risks:
  - Diff is above the ~400-line guideline (~740 product lines); it is the
    milestone-completing part and the WO mandates the whole report surface. Every
    source file is under the 500-line cap; components are small and separated.
  - Expand-in-place uses framer height:auto (sanctioned for the signature layout
    moment); reduced-motion degrades to opacity-only.
Blocker:  none
```
