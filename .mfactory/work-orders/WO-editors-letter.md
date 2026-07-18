# WO-editors-letter — E-12 The editor's letter (v0.2 · milestone 5, the finale)

Target repo: github.com/immaculatecross/erika · Branch: `feat/editors-letter` · Diff cap: ~400 lines (excl. lockfile). Single-PR milestone. **This PR completes E-12 and all of v0.2.**

**Milestone context.** Fifth and final milestone of v0.2 (the coaching layer, D-15). The editor's letter is a quiet weekly digest — the narrative counterpart to the Focus map: your trend this week, your best recasts, and the one thing to work on next week. Model-light: deterministic aggregation over data v0.1/v0.2 already produce. No model calls, no gamification, no streaks/points/badges — Erika speaks "like a good editor" (DESIGN.md copy rules).

## What already exists (reuse read-only)

- `lib/analysis/findings.ts`: `listAllFindingsWithSession(db)` (findings joined to their session `createdAt`) — the dated record the letter is built from. `Finding` has `quote`, `correction`, `explanation`, `category`, `severity`.
- `lib/focus.ts`: `computeFocus(sessions)`, `AnalyzedSession`, `collectAnalyzedSessions(db)`, the severity-weighting + per-category rate math — reuse it to compute a week's rates and the "what to work on" ranking rather than reimplementing.
- `lib/segments.ts` (`durationMs` → speech-hours), `lib/sessions.ts`. The Focus screen (`app/focus/page.tsx`) — link the letter from there.
- The shell/sidebar (already 6 items — do NOT add a 7th), design tokens, the empty-state component.

## Objective

A quiet **editor's letter** for the most recent week of analyzed speech. It shows: the **trend** — this week's error rate (overall and/or by category) versus the prior week, with its direction; **best recasts** — a few notable "you say X → natives say Y" moments from the week; and **the one thing to focus on next week** — the top severity-weighted pattern. Calm, editorial, specific ("3 grammar slips in 12 minutes", never "Great job!"), no gamification. Reachable from the Focus screen (a "This week's letter" link — NO new top-level nav item). With no analyzed speech yet, a quiet empty state.

## Pinned definitions (keep them explainable)

- **Week bounds:** ISO-8601 week (Monday 00:00 – Sunday 23:59, UTC), derived from each session's `createdAt`. Document it. The "current letter" is the most recent week that has analyzed findings.
- **Trend:** this week's rate vs the prior week's rate (reuse the focus rate math: findings ÷ speech-hours over that week's analyzed sessions). Direction = falling ⇒ improving. If there is no prior week, say so plainly (no fake trend).
- **Best recasts:** a documented, deterministic selection from the week's findings — e.g. up to 3, highest-severity first, de-duplicated, distinct categories preferred. State the rule.
- **The one thing:** the top-ranked category by the focus severity-weighted rate for the week (reuse the focus ranking); tie-break deterministically.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. All logic pure/unit-testable over seeded rows — no model, no network.

1. **Weekly composition.** A pure `lib/letter.ts` composes the latest week's letter from findings-with-session-dates (+ segments for speech-hours): correct week bounds, the trend direction vs the prior week, the deterministic best-recasts selection, and the focus-next category. Given fixtures spanning two weeks it matches the hand-computed letter; a single week reports "no prior week" rather than a fake trend. (Test.)
2. **Letter screen.** A `/letter` route, **reachable from the Focus screen** (a link/section — no new sidebar item), renders the latest week's letter in a calm editorial layout (DESIGN voice, tabular numerals, green/red only where a trend carries meaning, no gamification). A quiet empty state when there are no analyzed findings. (Test: seeded week renders trend + recasts + the one thing; zero → empty state.)
3. **Best recasts side by side.** The selected recasts show your phrase and the native correction side by side with the why. (Test: the selected set matches the documented rule and renders both sides.)
4. **No gamification, truthful.** No streaks/points/badges; the trend and counts are truthful (a worsening week says so plainly). (Test/inspection: assert the copy/data are the real figures, not inflated.)

## Files and constraints

- **New:** `lib/letter.ts` (pure weekly aggregation reusing focus math + `listAllFindingsWithSession`), `GET /api/letter` (Node, read-only; latest week, optionally `?week=`), `app/letter/page.tsx`, and a "This week's letter" link on `app/focus/page.tsx`. Optional past-week navigation is a nice-to-have, not required.
- **DESIGN.md binding:** editorial and calm — generous space, one quiet headline stat, the recasts, the one focus; ink accent, green/red only for trend meaning; system font, tabular numerals. No new UI dependency, no new nav item.
- **No migration, no model calls, no writes** — read/aggregate/display only. Do not change findings/focus/analysis behavior. (A model-written prose letter is a documented **v0.3** upgrade — do not build it here.)
- **Tests/e2e:** any Playwright spec uses a fresh/isolated DB per run (config defaults).
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green.

## Out of scope (do not touch)

- A model-generated prose letter (v0.3).
- The deferred v0.3 milestones (E-8 pronunciation studio, E-10 conversation gym, E-13 voice enrollment, E-14 hosting, E-15 mobile).
- All existing engines/contracts (reuse read-only); any new top-level nav item.

## Milestone ritual (this PR completes E-12 AND all of v0.2)

Flip **FEATURES.md E-12 `next → done`**. **v0.2 is now complete** — do NOT set any milestone to `next` (the current mission ends here; v0.3 is unscoped and awaits a fresh operator mission per D-15). **Regenerate STATE.md** (one screen) to reflect: **v0.2 complete** (focus map, phrasebook, speech archive, micro-lessons, editor's letter all shipped on top of v0.1's capture→ingest→analyze→flashcards loop); the unattended mission (D-15) is fulfilled; and the deferred v0.3 set (E-8/E-10/E-13/E-14/E-15) awaits a new mission. Keep it truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (the weekly math + the no-prior-week case especially), what they proved, and risks. Conventional-Commit title. Note that this PR completes v0.2.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/19  (feat/editors-letter → master)
Changed:  lib/letter.ts — pure weekly composition (ISO week bounds, trend vs prior week, deterministic best-recasts, focus-next), reusing computeFocus for the rate + severity-weighted ranking; collectLetterSessions/buildLetter read-only accessors.
          app/api/letter/route.ts — GET, Node, read-only; latest week or ?week=; { letter: Letter | null }.
          app/letter/page.tsx — calm editorial letter screen (headline stat, trend badge green/red only when a prior week exists, recasts side by side, the one thing); quiet empty state.
          app/focus/page.tsx — "This week's letter" link to /letter (no 7th nav item).
          tests/letter.test.ts (13) + e2e/letter.spec.ts (4).
          FEATURES.md E-12 next→done; STATE.md regenerated (v0.1+v0.2 complete, v0.3 deferred, no milestone next).
Verified: npm run test → 218 passed (letter.test.ts 13: ISO week bounds; trend improving/worsening + both rates; no-prior-week ⇒ no fake trend; deterministic best-recasts incl. dedupe/distinct-category/fill; focus-next; latest-week; null empty; done-only DB pass).
          npx playwright test letter.spec.ts → 4 passed (two-week render rate 1.0 + improving trend + recast + focus-next; first-week no trend badge; empty state; Focus link reaches /letter, nav still 6 items).
          npm run typecheck clean · npm run lint clean · npm run build succeeds (/letter + /api/letter compiled).
          npx playwright test shell.spec.ts focus.spec.ts → 9 passed (no regression).
Risks:    Prior-week trend is the immediately-preceding calendar week; a skipped week reads "no prior week" (documented, deliberate). Model-written prose letter is a documented v0.3 upgrade, not built here.
Blocker:  none.
```

## Repair note — PR #19 review fix (VCS-integrity / contract violation)

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/19  (feat/editors-letter → master)
Finding:  lib/letter.ts was committed as a BINARY blob — a literal NUL control byte (0x00) was
          embedded in the source at line 154 (best-recasts dedup key delimiter). git treated the
          file as binary: `git diff` = "Binary files differ", `gh pr diff 19` omitted it, `file` = data.
          The source routed around the reviewer's `gh pr diff` gate and broke line-level diff/blame/merge.
Changed:  lib/letter.ts — replaced the single raw NUL byte with the two-character escape `\0` in the
          template string. Behavior-preserving: the dedup key still uses NUL (U+0000) as its delimiter
          at runtime (quote + \0 + correction). No logic, delimiter, or dedup-rule change. Whole-file
          control-byte scan: exactly one raw byte existed; zero remain.
Verified: file lib/letter.ts        → "Java source, Unicode text, UTF-8 text" (text, not `data`).
          git diff master...feat/editors-letter -- lib/letter.ts → normal textual diff
                                       (index 0000000..bf32675, "@@ -0,0 +1,283 @@"; NOT "Binary files differ");
                                       the dedup line is visible: const key = `...}\0${...}`.
          gh pr diff 19               → includes lib/letter.ts's added lines.
          tr -cd '\000' | wc -c      → 0 remaining NUL bytes; control-byte grep → none.
          npm run test               → 218 passed (tests/letter.test.ts 13/13, incl. the best-recasts
                                       dedup test criterion 3 — unchanged, still keys on quote+NUL+correction).
          npm run lint · npm run typecheck · npm run build → all clean/succeed.
          .mfactory/hooks/run-tripwires.sh → exit 0 (green).
Risks:    none identified — change is scoped to removing one raw byte; runtime dedup behavior identical.
Blocker:  none.
```
