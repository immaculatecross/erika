# WO-session-map — E-22 The session map (v0.3 · milestone 7)

Target repo: github.com/immaculatecross/erika · Branch: `feat/session-map` · **Review tier: Light** (additive UI over existing read-models + one pure function; the worker MUST raise to Full if it ends up touching the ingest/analysis correctness path, money, or a migration — it should not need to).
Batch: **solo** (serial chain; E-23 follows on the merged result).

## Objective

The session page gains a **map**: the timeline plots each finding as a severity-tinted marker on the segment it belongs to; clicking a segment plays it, and selecting a finding highlights its segment. Focus gains a **"when you slip"** distribution — findings by wall-clock hour — from a pure, unit-tested function. Read-only over existing data: **no model calls, no migration, no new tables.**

## Acceptance criteria (each ≥1 test; no network)

1. **Session map.** On the session page, the existing segment timeline renders a marker per finding positioned on the finding's segment/timestamp, tinted by severity (reuse the shared `SEVERITY_STYLES` from E-18 — high red, resolved/mastery green only; medium/low neutral per D-14). Findings read through `lib/findings-model.ts` (no local gate). A session with no analysed segments shows the existing empty/ös state, not an empty broken map.
2. **Segment ↔ finding interaction.** Clicking a segment plays it (reuse the existing `/sessions/[id]?t=` jump-to-audio / player seek — do not reimplement playback); selecting a finding highlights/scrolls to its segment and vice-versa. Covered by a render-level test (no DOM/network) asserting the marker→segment mapping, plus the selection state.
3. **"When you slip" distribution.** A pure function `lib/slip-hours.ts` (or a clearly-named module) buckets included findings by wall-clock **hour of day** (state the timezone basis explicitly — UTC vs local; be consistent with how timestamps are stored, see docs/schema.md) into 24 buckets, unit-tested including the empty case (all zero, never NaN) and a DST/midnight-boundary note if local. Focus renders it as a quiet distribution (monochrome bars, tabular numerals, DESIGN-binding); it does not add a nav item.
4. Marker placement is correct for a finding whose segment was time-remapped by cache reuse (E-16) — the marker sits on the *target* session's segment, not a donor timestamp. (Test with a finding carrying a remapped timestamp.)

## Files and constraints

- Touch: the session page + its timeline/segment components, a new `lib/slip-hours.ts`, `lib/focus.ts` or the Focus page (distribution only — do NOT change the ranking/rate math). Read findings via `lib/findings-model.ts`.
- Do NOT touch: `lib/analysis/**`, migrations (stay **v12**), the cascade/prompts, spend/ledger, SM-2, the render/rendition engine (E-21), FEATURES.md, STATE.md.
- DESIGN.md binding: ink accent, green/red only with meaning, spring motion, tabular numerals, no new nav item. Files < 500 lines; Conventional Commits; never commit `data/`; verification on throwaway DBs only, never `data/erika.db`.

## Out of scope

Ask Erika (E-23), Targets, pagination, any model call, editing the segment extraction or playback engine itself (reuse it).

## PR + exit report

Conventional-Commit title; body: what changed, exact verification commands, risks. Append the `task.md` exit block to this file. Token-efficient: read CLAUDE.md, DESIGN.md, and only the files this WO names plus immediate dependencies; no repo-wide sweep; terse report. Commit incrementally.

## Exit report

```
RESULT: done
PR:       feat/session-map
Changed:  lib/session-map.ts — pure finding→segment mapping (marker placement, highlight set)
          lib/slip-hours.ts — pure UTC hour-of-day bucketing of findings
          lib/focus.ts — FocusPayload gains slipHours via listIncludedFindingsWithSession
          components/segment-timeline.tsx — renders a severity-tinted marker per finding (SEVERITY_STYLES)
          components/ingest-status.tsx — threads map props to the timeline
          components/analysis-report.tsx — row highlight + scroll-into-view on selection
          components/analysis-panel.tsx — analysis poll lifted to a prop; threads selection
          app/sessions/[id]/page.tsx — lifts useAnalysis; shared segment↔finding selection; marker click plays
          components/slip-hours.tsx + app/focus/page.tsx — quiet monochrome "when you slip" distribution
Verified: npx tsc --noEmit (0); npx vitest run (60 files, 411 tests pass, incl. 4 new suites);
          npx next lint (clean); npm run build (ok); run-tripwires.sh --all (exit 0).
          End-to-end on a throwaway DB (ERIKA_DB_PATH): seeded session with 3 findings across 2 segments,
          next start + curl proved /api/sessions/demo/analysis findings map to correct segments
          (3000/6000→seg0, 24000→seg1), /api/focus slipHours bucketed all 3 at hour 9 (peak), pages 200.
          data/erika.db never touched.
Risks:    "When you slip" is UTC-based (consistent with SQLite UTC storage; no DST) and anchors each slip
          at session capture time + recording offset — a proxy for wall-clock (upload time for uploads).
          Marker click reuses the existing player seek; no playback engine changed.
Blocker:  none
```
