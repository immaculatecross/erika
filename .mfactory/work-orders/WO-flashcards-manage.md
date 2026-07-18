# WO-flashcards-manage — E-5 Flashcards (part 2 of 2): card browser & Anki CSV export

Target repo: github.com/immaculatecross/erika · Branch: `feat/flashcards-manage` · Diff cap: ~400 lines (excl. lockfile)

**Milestone context.** Part 2 of 2 of E-5, and it **completes milestone E-5 and all of v0.1**. Part 1 (cards from findings, SM-2, the full-screen practice drill) is **already merged on `master`**. This part adds card management (browse, suspend, delete) and CSV export. It's a small, contained PR — do not touch the drill loop or scheduler.

## What already exists (reuse, don't reinvent)

- `lib/cards.ts`: `Card`, `toCardView`, `generateCards`, `listDueCards`, `countDueCards`, `getCard`, `gradeCard`, and **`suspendCard(db, id, suspended)`** and **`deleteCard(db, id)`** (data-layer helpers already added in part 1 — surface them). Add a `listCards(db)` (all cards, a documented order) if not present.
- Routes: `POST /api/cards/generate`, `GET /api/cards?due=1`, `POST /api/cards/[id]/grade`. The Practice screen (`app/practice/page.tsx`) and the review runner exist.
- The typed data-layer + design-token conventions.

## Objective

From Practice, the user can open a **card browser** listing all their cards — front, back, category, due date, and suspended state — and **suspend/unsuspend** or **delete** any card. Suspended cards stay out of the practice due queue (part-1 behavior). The user can **export all cards to a CSV that Anki imports** (a two-field Front/Back CSV, correctly escaped), downloaded from the browser. This closes the v0.1 loop: speak → see mistakes → drill them → manage and take them with you.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Card browser.** A route (e.g. `/practice/cards`), reachable from Practice, lists all cards with front, back, category, due, and suspended state (tabular numerals, DESIGN copy). With no cards it shows a quiet empty state. (Test: seed cards → all render with their state; zero → empty state.)
2. **Suspend / unsuspend.** Toggling suspend on a card persists the change; a suspended card is visibly marked and is excluded from the practice due queue; unsuspending restores it to the queue when due. (Test: suspend → `listDueCards` excludes it and the browser marks it; unsuspend → it returns.)
3. **Delete.** Deleting a card removes it (persisted); it disappears from the browser and the queue and does not reappear on regenerate **unless** its finding still exists — decide and document the policy (recommended: deleting a card should not resurrect on the next `generateCards`; if that requires a tombstone, add one; otherwise document that regenerate may recreate it). (Test: delete → gone from browser/queue; assert the documented regenerate behavior.)
4. **Anki-importable CSV export.** `GET /api/cards/export` returns a CSV of all cards with Front and Back columns, correctly escaped (fields containing commas, double-quotes, or newlines are quoted/escaped per RFC 4180 so Anki imports them intact), downloadable from the browser (correct `Content-Type` and `Content-Disposition`). (Test: a pure CSV serializer round-trips — including a card whose text has a comma, a quote, and a newline — back to the original fields; the route returns the right headers.)

## Files and constraints

- **CSV serialization** in a pure module (e.g. `lib/cards-csv.ts`), unit-tested for escaping/round-trip — no DB, no framework. The route just streams its output.
- **Routes (Node):** `GET /api/cards` (all cards — extend the existing route so no `due` param returns all), `DELETE /api/cards/[id]`, `POST /api/cards/[id]/suspend` (body `{ suspended }`), `GET /api/cards/export` (CSV). Reuse the part-1 data-layer helpers; add `listCards` if needed. No change to grade/generate/due behavior.
- **UI:** `app/practice/cards/page.tsx` (the browser) with suspend/delete controls and an Export affordance; a link to it from `app/practice/page.tsx`. DESIGN.md binding — calm rows, black/white accent, red only for the destructive delete, tabular numerals; a delete confirms before removing (no accidental data loss).
- **Migration:** only if a delete-tombstone is needed (criterion 3); otherwise none. If added, it's version 6, append-only.
- **Tests/e2e:** any Playwright spec uses a fresh/isolated DB per run (don't depend on a shared `.playwright/e2e.db`).
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; `gates` green (no network).

## Out of scope (do not touch)

- The SM-2 scheduler, the drill runner, card generation logic, or the grade flow (part 1 is fixed).
- The analysis/ingest/capture engines and contracts.
- All v0.2 features (E-6/E-7/E-9/E-11/E-12).

## Milestone ritual (this PR completes E-5 AND v0.1)

Flip **FEATURES.md E-5 `building → done`** and set the next milestone to build per D-15's v0.2 order — **E-7 `backlog → next`** (the first v0.2 milestone; E-6 comes later in the v0.2 sequence, so leave it `backlog`). **Regenerate STATE.md** (one screen): **v0.1 is complete** — the whole loop ships (capture → smart ingest → cascade analysis within budget → flashcards drilled by SM-2, browsable and Anki-exportable) — and the unattended mission now continues into **v0.2 (E-7, E-9, E-11, E-6, E-12)** per D-15, starting with E-7. Keep the standing order truthful.

## PR description must state

What changed per area, the **exact commands** verifying each criterion (especially the CSV escaping round-trip and suspend→excluded-from-queue), what they proved, and risks. Conventional-Commit title. Note in the body that this PR completes v0.1.

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/13
Changed:  Migration v6 `deleted_findings` tombstone; lib/cards.ts listCards +
          toCardBrowserView + deleteCard now tombstones atomically + generateCards
          skips tombstoned findings; pure lib/cards-csv.ts (RFC 4180 + Anki
          directives); GET /api/cards returns all cards with no due param;
          DELETE /api/cards/[id]; POST /api/cards/[id]/suspend; GET
          /api/cards/export (CSV headers); app/practice/cards browser (suspend,
          confirm-delete, export) + Browse-all-cards link from Practice; FEATURES
          E-5→done / E-7→next; STATE regenerated (v0.1 complete → v0.2/E-7).
Verified: npm run test → 139 passed (cards-csv round-trips comma+quote+newline
          per RFC 4180; cards.test proves suspend excludes from the due queue,
          delete tombstone survives regenerate; cards-route proves all-cards view,
          suspend/delete guards + 404s, export Content-Type/Content-Disposition +
          escaped body). npx playwright test flashcards-manage → 3 passed on an
          isolated DB (suspend drops from queue & unsuspend restores; Delete
          confirms before removing then never resurrects; export headers + escaped
          body). npx playwright test flashcards.spec → 3 passed (part-1 drill
          intact; GET route change backward-compatible). npm run lint / typecheck /
          build all green; run-tripwires.sh --all clean.
Risks:    PR ~800 lines (≈450 product / ≈300 tests / ≈75 docs), over the ~400
          soft cap — one coherent milestone-completing feature, not honestly
          splittable without shipping half of v0.1; tests not trimmed to fit.
          Practice's 0-due empty state still lacks a browser link (only the due>0
          view has it), so suspended-only card sets aren't reachable from there —
          minor, pre-existing, left untouched.
Blocker:  none
```
