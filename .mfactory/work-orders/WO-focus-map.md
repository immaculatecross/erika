# WO-focus-map — E-7 Focus map & progress metrics (v0.2 · milestone 1)

Target repo: github.com/immaculatecross/erika · Branch: `feat/focus-map` · Diff cap: ~400 lines (excl. lockfile). Single-PR milestone; if it genuinely can't fit, report `split` (e.g. aggregation lib+API, then the screen).

**Milestone context.** First milestone of **v0.2** (the coaching layer, D-15). This is the insight surface: Erika stops merely listing mistakes and shows you your **patterns over time** and **what to work on next**, on one screen. It's model-light — pure aggregation over data v0.1 already produces (findings, speech segments, sessions). No model calls, no new capture/analysis behavior.

## What already exists (reuse read-only)

- `lib/analysis/findings.ts`: `Finding` (`category ∈ {grammar,vocabulary,phrasing,idiom,pronunciation}`, `severity ∈ {high,medium,low}`, `sessionId`, `startMs`…), `listFindings(db, sessionId)`. Add an all-sessions accessor if needed (e.g. `listAllFindings`).
- `lib/segments.ts`: `listSegments(db, sessionId)` with `durationMs` — **speech time** is the sum of a session's segment durations.
- `lib/sessions.ts`: `listSessions` (with `createdAt`, `durationSeconds`). `lib/analysis/cascade.ts`: analysis job state — a session counts as *analyzed* when its analysis is `done`.
- The shell/sidebar (`app/layout.tsx`), design tokens, Motion helpers, and the empty-state component.

## Objective

A new **Focus** screen answers, on one screen: *how often do I make each kind of mistake, is it getting better, and what should I work on next?* It shows the **error rate per speaking-hour, by category** (findings in a category ÷ total analyzed speech-hours), **trended across sessions** so improvement or regression is visible, and a **ranked "what to work on next"** list. With nothing analyzed yet it shows a quiet empty state.

## Pinned metric definitions (keep them explainable)

- **Speech-hours** (denominator) = Σ segment `durationMs` over **analyzed** sessions ÷ 3,600,000. Only analyzed sessions count (a session with speech but no analysis contributes neither findings nor hours).
- **Category error rate** = (findings in that category) ÷ (total analyzed speech-hours), shown per hour (tabular numerals).
- **Trend** = the rate bucketed chronologically — per analyzed session in order, or per day/week (pick one, document it) — so each category's direction (improving = rate falling) is visible.
- **"What to work on next" rank** = categories ordered by a **severity-weighted rate** (weight high=3, medium=2, low=1: Σ(weight×count) ÷ speech-hours), highest first, showing the count and rate. Document the formula on-screen or in a tooltip so the ranking is never a black box.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. All logic is pure/unit-testable over seeded rows — no model, no network.

1. **Per-category rate.** A pure aggregation (`lib/focus.ts`) computes each category's findings-per-speech-hour over analyzed sessions; given fixture findings + segments it matches the hand-computed figures, and a category with zero findings reads 0 (not absent/NaN). (Test.)
2. **Trend across sessions.** The rate is bucketed chronologically per the documented scheme; two buckets with different rates produce a trend that reflects the direction (e.g. later bucket lower ⇒ improving). (Test: seed an early high-rate and a later low-rate bucket → trend shows the drop.)
3. **Ranked "what to work on next."** Categories rank by the severity-weighted rate, highest first; findings skewed to one category rank it first; ties broken deterministically. (Test.)
4. **One screen + nav + empty state.** A `/focus` route, added to the sidebar (a fourth item — "Focus"), presents the per-category rates, the trend, and the ranking together. With no analyzed sessions it shows a quiet DESIGN-compliant empty state. (Test: route renders with seeded data; empty when none.)

## Files and constraints

- **New:** `lib/focus.ts` (pure aggregation — the metric math above, no DB coupling beyond typed reads), `GET /api/focus` (Node; returns the computed model), `app/focus/page.tsx` (the screen), and hand-rolled **SVG** chart components (e.g. `components/sparkline.tsx`, category bars). Add the "Focus" sidebar item.
- **No charting library** — DESIGN.md sanctions only Motion + Lucide; charts are hand-rolled SVG, **monochrome** (ink on canvas), tabular numerals. Green/red only where they carry meaning — an *improving* trend may read green, a *worsening* one red (D-14: color = meaning). No category-rainbow.
- **No migration, no model calls, no writes** — this is a read/aggregate + display milestone. Do not change findings/segments/analysis behavior.
- **Tests/e2e:** any Playwright spec uses a fresh/isolated DB per run.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green.

## Out of scope (do not touch)

- Micro-lessons (E-6), phrasebook (E-9), speech archive (E-11), editor's letter (E-12) — later v0.2 milestones.
- The analysis/ingest/capture/flashcards engines and contracts (reuse read-only).
- Any model/API call or cost logic.

## Milestone ritual (this PR completes E-7)

Single-PR milestone: flip **FEATURES.md E-7 `next → done`** and **E-9 `backlog → next`** (E-9 is the next v0.2 milestone per D-15; leave E-6/E-8 `backlog`), and **regenerate STATE.md** (one screen) to reflect the Focus map shipped and E-9 (phrasebook) is next. Keep the v0.2 standing order (D-15) truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (the metric math especially), what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/14
Changed:  lib/focus.ts — pure metric math (computeFocus) + typed-read collector (collectAnalyzedSessions/buildFocusModel): speech-hours denominator over analyzed sessions, per-category rate (zero-filled, not NaN), chronological per-session trend, severity-weighted "work on next" rank with deterministic tie break.
          GET /api/focus — serves the FocusModel (Node, read-only).
          app/focus/page.tsx — the Focus screen: hero error-rate, SVG sparkline + trend badge, ranked category bars, on-screen formula, quiet empty state.
          components/sparkline.tsx + components/category-bars.tsx — hand-rolled monochrome SVG charts; green/red only on trend meaning (D-14).
          components/sidebar.tsx — added the fourth "Focus" nav item.
          tests/focus.test.ts (unit, 7) + e2e/focus.spec.ts (3) — metric math vs hand-computed fixtures + screen/empty-state render.
          FEATURES.md E-7 next→done, E-9 backlog→next; STATE.md regenerated.
Verified: npm run test → 146 pass — focus.test.ts proves per-category rate (4/h & 2/h over 1.0h; empty cats = 0 not NaN; zero-hours = 0), trend (early 4/h vs later 1/h out of order ⇒ improving; rising ⇒ worsening; single bucket ⇒ flat), ranking (idiom weight-6 first; 3-vs-3 tie by category order), and buildFocusModel counting only done-analysis sessions (empty on a fresh DB).
          npx playwright test e2e/focus.spec.ts → 3 pass — renders hero rate + 5-row ranking + sparkline on seeded data, shows the empty state when none analyzed, marks the Focus nav item current.
          npm run typecheck / lint → clean. npm run build → succeeds, /focus + /api/focus present. Screenshotted /focus (monochrome, tabular, green only on improving).
Risks:    Trend direction is earliest-vs-latest bucket (per session), not a fitted slope — chosen for explainability, documented on-screen; revisit for day/week buckets. Per-session reads loop over sessions — fine at current scale.
Blocker:  none.
```
