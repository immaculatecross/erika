# WO-phrasebook — E-9 Phrasebook / the recast library (v0.2 · milestone 2)

Target repo: github.com/immaculatecross/erika · Branch: `feat/phrasebook` · Diff cap: ~400 lines (excl. lockfile). Single-PR milestone; report `split` only if it genuinely can't fit.

**Milestone context.** Second milestone of v0.2 (the coaching layer, D-15). The Phrasebook is a searchable reference library of your recasts — "you say X, natives say Y" — built from the analysis findings v0.1 already produces. Model-light: pure view + search over findings, plus a "pin into flashcards" action. No model calls, no new analysis.

## What already exists (reuse read-only unless noted)

- `lib/analysis/findings.ts`: `Finding` (`quote` = what you said, `correction` = the native recast, `explanation` = why, `category`, `severity`, `sessionId`, `startMs`). `listFindings(db, sessionId)` — **add `listAllFindings(db)`** (all findings across sessions) for the bank.
- `lib/cards.ts`: `generateCards` (bulk, one card per finding, **skips tombstoned findings**), `deleteCard` (tombstones via `deleted_findings` so a deleted card doesn't resurrect on regenerate), `listDueCards`, card front/back construction (`cards-view`). Migration v6 `deleted_findings` exists.
- The shell/sidebar, design tokens, the audio player + Range route (for optional jump-to-audio), the empty-state component.

## The "pin" reconciliation (pin has real meaning — design it right)

v0.1 auto-generates a card for every finding, and E-5b lets the user **delete** a card (writing a `deleted_findings` tombstone so it won't regenerate). So the flashcard deck is a *curated subset* of findings, while the Phrasebook is the *full library*. **Pinning a phrasebook entry into flashcards** therefore means: ensure a card exists for that finding, **clearing any tombstone** — so an entry the user previously removed from their deck can be deliberately added back. Add a single-finding helper (e.g. `createCardForFinding(db, findingId)`) that removes any tombstone for that finding and inserts its card (idempotent — if a card already exists, it stays; no duplicate). Do NOT change the bulk `generateCards`, the SM-2 scheduler, or the grade/due behavior.

## Objective

A new **Phrasebook** screen lists every recast built from your findings — the original utterance and the native correction **side by side**, with the why, category, and severity — and is **searchable** (free text across your phrase / the recast / the explanation) and filterable by category. Any entry can be **pinned into flashcards** (added to your drill deck, clearing a prior deletion), with clear feedback about whether it's already in the deck. With no findings yet it shows a quiet empty state.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. All logic pure/unit-testable over seeded rows — no model, no network.

1. **The bank, side by side.** A `/phrasebook` route (added to the sidebar) lists entries from all findings — `quote` (you say) beside `correction` (natives say), plus explanation, category, severity. Empty state when there are no findings. (Test: seeded findings render as entries with both sides; zero → empty state.)
2. **Search + category filter.** A pure filter narrows entries by a free-text query (matched against quote/correction/explanation, case-insensitive) and by category; combined query+category is the intersection; an empty query returns all. (Test: query and category cases against fixtures, including no-match.)
3. **Pin into flashcards.** Pinning an entry creates a card for its finding via `createCardForFinding`: idempotent (pin twice → exactly one card), and **clears any `deleted_findings` tombstone** so a previously-deleted card returns and shows up in the due queue. The UI reflects whether an entry is already in the deck. (Test: pin → a card exists and is in `listDueCards`; pin a tombstoned finding → tombstone gone + card present; pin twice → one card.)
4. **Full-utterance recast + truthful states.** The original and recast are both shown in full (not truncated to unreadability); a pinned/already-in-deck entry is marked truthfully. (Covered by 1+3; assert the already-in-deck marker.)

## Files and constraints

- **New:** `lib/phrasebook.ts` (pure entry shape + search/filter over findings), `listAllFindings` in `findings.ts`, `createCardForFinding` in `cards.ts` (single-finding pin, un-tombstone + insert, idempotent), `GET /api/phrasebook` (Node; entries, optionally with which are in-deck), `POST /api/phrasebook/[findingId]/pin` (or `/api/cards/pin`), `app/phrasebook/page.tsx`, and the "Phrasebook" sidebar item.
- **DESIGN.md binding:** calm two-column recast rows, black/white accent, green/red only where meaning (e.g. severity, or a subtle "in deck" confirmation), tabular numerals; search is a plain input, category filter a segmented control or quiet chips; no new UI dependency. Optional jump-to-audio (finding has `sessionId`+`startMs`) is a nice-to-have, not required — keep scope tight.
- **No migration** (reuses findings/cards/deleted_findings). **No model calls, no analysis/ingest/capture changes.** The only cards.ts change is the additive `createCardForFinding`.
- **Tests/e2e:** any Playwright spec uses a fresh/isolated DB per run.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green.

## Out of scope (do not touch)

- Speech archive (E-11), micro-lessons (E-6), editor's letter (E-12) — later v0.2 milestones.
- The SM-2 scheduler, bulk `generateCards`, grade/due flow, the analysis/ingest/capture engines and contracts.
- Any model/API call.

## Milestone ritual (this PR completes E-9)

Single-PR milestone: flip **FEATURES.md E-9 `next → done`** and **E-11 `backlog → next`** (E-11 is next per D-15's order E-7,E-9,E-11,E-6,E-12; leave E-6/E-8/E-10 `backlog`), and **regenerate STATE.md** (one screen) to reflect the Phrasebook shipped and E-11 (speech archive) is next. Keep the D-15 v0.2 standing order truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (especially the pin idempotency + un-tombstone), what they proved, and risks. Conventional-Commit title.

## Exit report

```
RESULT: done
PR:       <filled on push — feat/phrasebook → master>
Changed:
  - lib/analysis/findings.ts: add listAllFindings(db) — the full recast library across sessions (newest first).
  - lib/cards.ts: add additive createCardForFinding(db, findingId) — single-finding pin: clears any deleted_findings tombstone, then idempotently inserts the card (INSERT OR IGNORE on finding_id). generateCards / SM-2 / grade/due untouched.
  - lib/phrasebook.ts: new pure, client-safe core — PhrasebookEntry, buildEntries(findings, inDeckSet), filterEntries (query × category intersection, case-insensitive, blank→all).
  - app/api/phrasebook/route.ts (GET): entries from listAllFindings, each marked inDeck (a card exists for the finding, via listCards).
  - app/api/phrasebook/[findingId]/pin/route.ts (POST): pin via createCardForFinding; 404 unknown finding.
  - app/phrasebook/page.tsx + components/sidebar.tsx: calm two-column recast screen (you say | natives say), plain search, quiet category chips, per-entry pin / "in deck" marker; new sidebar item (Library icon).
  - tests: tests/phrasebook.test.ts (pure filter/build), tests/phrasebook-route.test.ts (GET + pin idempotency/un-tombstone/404), createCardForFinding block in tests/cards.test.ts, e2e/phrasebook.spec.ts; e2e/shell.spec.ts nav count 3→5 (stale since E-7).
  - FEATURES.md (E-9 done, E-11 next), STATE.md regenerated.
Verified:
  - npm run lint · npm run typecheck — clean.
  - npm run test — 161 passed (27 files), incl. the new pure filter/build, createCardForFinding (pin twice → one card; un-tombstone → returns to listDueCards; existing schedule preserved; unknown → null), and the two routes (GET across sessions with inDeck flag; pin idempotent + un-tombstone + 404).
  - npm run build — production build green; /phrasebook + both API routes emitted.
  - npx playwright test e2e/phrasebook.spec.ts — 4 passed: both sides render, already-in-deck marked truthfully, pin moves a fresh entry into the deck, quiet empty state, sidebar active. (e2e is not a CI gate; a handful of pre-existing flashcards/analysis specs are flaky on the shared dev-server DB independent of this change — confirmed against clean master.)
  - Visual QA: npm run screenshot -- /phrasebook — DESIGN-compliant (ink accent, severity green/orange/red + green "in deck" check as the only colour, two-column rows, tabular count).
Risks:
  - "In deck" = a card row exists for the finding (includes suspended cards — a suspended card is in the deck, just not due). Pin does not unsuspend an existing card by design (idempotent, schedule untouched).
  - Client-side filtering loads the whole library; fine at v0.2 finding volumes, revisit if a library grows very large.
Blocker:  none.
```
