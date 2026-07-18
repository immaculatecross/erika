# WO-speech-archive — E-11 Speech archive (v0.2 · milestone 3)

Target repo: github.com/immaculatecross/erika · Branch: `feat/speech-archive` · Diff cap: ~400 lines (excl. lockfile). Single-PR milestone.

**Milestone context.** Third milestone of v0.2 (the coaching layer, D-15). The Speech archive is your speaking life at a glance: a searchable, time-ordered timeline of your analyzed speech, filterable by category and severity, each moment linking back to its audio. Model-light — a time-organized view over existing findings. No model calls, no new analysis. (It complements E-9: the Phrasebook organizes findings as a *recast reference*; the Archive organizes them *chronologically*.)

## What already exists (reuse read-only unless noted)

- `lib/analysis/findings.ts`: `Finding` (`quote` = what you said, `correction`, `explanation`, `category ∈ {grammar,vocabulary,phrasing,idiom,pronunciation}`, `severity ∈ {high,medium,low}`, `sessionId`, `startMs`, `endMs`); `listAllFindings(db)` (all findings across sessions). The archive needs each finding's **session date** for chronological order — add an accessor that returns findings joined with their session `createdAt` (e.g. `listAllFindingsWithSession`), or join in the archive builder.
- `lib/sessions.ts` / `lib/session-types.ts`: `Session` with `createdAt`, `originalFilename`.
- `app/sessions/[id]/page.tsx` + the audio player and `GET /api/sessions/[id]/audio` (Range) — **jump-to-audio** links an archive entry to its session, seeked to the finding's `startMs` (the analysis report already does this seek; reuse the mechanism/route/query so behavior is consistent).
- The shell/sidebar, design tokens, the empty-state component. (Note: the sidebar already has 5 items — Sessions, Practice, Phrasebook, Focus, Settings; keep the addition calm.)

## Objective

A new **Archive** screen presents every analyzed moment of your speech in **chronological order** (newest first, grouped by session or day), each row showing what you said (the `quote`), its category and severity, and when — with a **jump-to-audio** that opens the source session at that timestamp. The archive is **searchable** (free text over your speech / correction / explanation) and **filterable by category and by severity** (combinable). "Transcripts exist only as analysis byproducts" — there is no separate transcript; the finding quotes are the record. With nothing analyzed yet it shows a quiet empty state.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. All logic pure/unit-testable over seeded rows — no model, no network.

1. **Chronological timeline.** An `/archive` route (added to the sidebar) lists analyzed findings ordered by (session `createdAt`, then `startMs`), newest first, grouped legibly by session or day; each row shows the quote, category, severity, and a timestamp. Empty state when there are no findings. (Test: seeded findings across two sessions render in the correct chronological order; zero → empty state.)
2. **Search.** A pure free-text filter (case-insensitive over quote/correction/explanation); blank → all; no-match → empty. (Test.)
3. **Filter by category and severity.** Independent category and severity filters that combine as an intersection with each other and with the search query. (Test: category-only, severity-only, both, plus search — each narrows correctly.)
4. **Jump-to-audio.** Each entry links to its session at the finding's `startMs`, reusing the existing session-audio seek (consistent with the analysis report's jump-to-audio). (Test/e2e: activating an entry navigates to `/sessions/[id]` and the player is positioned at the finding's start.)

## Files and constraints

- **New:** `lib/archive.ts` (pure timeline build + search/category/severity filter over findings enriched with session date), the findings-with-session accessor, `GET /api/archive` (Node, read-only), `app/archive/page.tsx`, hand-rolled timeline UI, and the "Archive" sidebar item.
- **DESIGN.md binding:** calm chronological rows/day-groups, black/white accent, green/red only where they carry meaning (severity), tabular numerals for timestamps; search is a plain input, filters are quiet chips/segmented controls; no new UI dependency. Keep the sidebar calm at 6 items — if it reads crowded, keep labels terse; do NOT restructure the shared shell into sections in this PR (that's a separate design decision — note it as a risk if you feel it).
- **No migration, no model calls, no writes** — read/aggregate/display only. Do not change findings/analysis/ingest/capture behavior.
- **Tests/e2e:** any Playwright spec uses a fresh/isolated DB per run (and follow the repo's `playwright.config.ts` DB-path convention so worker and dev-server share the DB — don't override `ERIKA_DB_PATH` on the CLI).
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green.

## Out of scope (do not touch)

- Micro-lessons (E-6), editor's letter (E-12) — later v0.2 milestones.
- The analysis/ingest/capture/flashcards/phrasebook engines and contracts (reuse read-only).
- Any model/API call; any sidebar section-restructure.

## Milestone ritual (this PR completes E-11)

Single-PR milestone: flip **FEATURES.md E-11 `next → done`** and **E-6 `backlog → next`** (E-6 is next per D-15's order E-7,E-9,E-11,E-6,E-12; leave E-8/E-10 `backlog`), and **regenerate STATE.md** (one screen) to reflect the Speech archive shipped and E-6 (micro-lessons) is next. Keep the D-15 v0.2 standing order truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (chronological order + the combined filters especially), what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.
