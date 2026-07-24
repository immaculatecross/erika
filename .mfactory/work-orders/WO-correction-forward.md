# WO-correction-forward — Correction-forward, error-once (E-29)

Target repo: immaculatecross/erika · Branch: `feat/correction-forward` · **Review tier: Light**
<!-- Light: presentation/UX over the existing findings read-model — no money, no migration,
     no model calls, no concurrency, no external contract. DESIGN.md is binding (UI change).
     Raise to Full only if you find yourself touching a Full-tier surface. -->
<!-- Batch: solo. Closes v0.4's ID order (E-26 lexicon/syllabus still follows in build order). -->

## Objective

D-18 lands across the three surfaces that show the user their own errors, so a mistake is **never a practice stimulus** and is seen **exactly once**, at feedback, clearly marked. (1) **Flashcards & exercise prompts** become *meaning-first*: the retrieval target is always the **correct** form, and the user's erroneous utterance never appears on a card front or an exercise prompt — it shows only on the back/feedback, headlined by the correction, the original subordinate and unmistakably marked. (2) The **session report** presents each finding **correction-first** — the correction headlined, the original quote shown once beneath it, marked as the error. (3) The **phrasebook** flips to **correction-forward with tap-to-reveal** — the native form leads; "you said X" is revealed on tap. **Contrastive playback (E-21 Compare) and the slips dossier (E-20) are unchanged** — they are deliberate noticing and analytics, not drills (D-18). No new data, no model calls: everything is re-derived from existing finding fields (quote, correction, explanation, category) at generation/display time.

## Acceptance criteria

1. **Card fronts are meaning-first; the error is never the stimulus.** A card's front (and any exercise prompt built from a finding) presents the **meaning/target**, not the user's error — an Italian **context gap** (the utterance context with the target span blanked, cued toward the correct form) or an equivalent meaning cue, derived from the finding's `correction`/`explanation`/`context` **without a model call**. The **back** shows the correction headlined with the *why*, and the original `quote` **once**, subordinate and marked as the error. A test asserts the generated front does **not** contain the raw error `quote` and that the back does (marked). **Existing cards flip too** — prefer re-deriving the display front from the joined finding at read time (cards carry `findingId`) so no migration and no stored-front backfill is needed; if you must change stored generation, regenerate deterministically (still no migration). State which you did.
2. **The drill still works end-to-end.** Full-screen practice, the 3D flip, Again/Hard/Good/Easy grading + FSRS scheduling (E-25), keyboard shortcuts, suspend/delete, and CSV export all behave as before — only *what the front shows* changes. A test/ःcheck confirms the drill flow is intact (grading still schedules + logs evidence).
3. **Session report is correction-first.** Each finding in the report leads with the **correction** (headlined), with the original `quote` shown **once** beneath, visually subordinate and marked as the error (not deleted — it's the one confrontation). Per-category counts, expand/collapse, and jump-to-audio at the finding timestamp are unchanged. A test/render check asserts the correction precedes and is more prominent than the quote.
4. **Phrasebook is correction-forward, tap-to-reveal.** Rows lead with the native/correct form; the user's "you say X" is hidden behind a tap-to-reveal (the error shown once, on demand). Search still works over both sides; **pin-into-deck** (`createCardForFinding`) is unchanged in behavior. Compare (E-21) on phrasebook rows stays. A test covers the reveal state (error hidden by default, revealed on toggle).
5. **Compare and the slips dossier are untouched.** Contrastive playback (card backs + phrasebook) and the slips dossier interleave/timeline render exactly as before — no correction-forward reflow there (D-18: noticing/analytics, not drills). A test or explicit note confirms no behavioral change to those surfaces.
6. **DESIGN.md fidelity.** Quiet, exact, sentence-case copy; the "marked as error" treatment uses the semantic palette meaningfully (a red/struck/labelled subordinate line — red is *meaning* here, D-14), never decoration; motion/spacing per DESIGN. No new nav, no green misuse (LOW/neutral stays neutral).

## Files and constraints

- **Changed (likely):** `lib/cards.ts` and/or `lib/cards-view.ts` (front derivation → meaning-first; back marks the error once), the flashcard front/back components under `components/`/`app/practice/*`, `lib/phrasebook.ts` + `app/phrasebook/*` (correction-forward + reveal), the session report under `app/sessions/[id]/*` (correction-first finding rows). Reuse the shared severity styles.
- **Contracts that must not break:** the SM-2→**FSRS** drill/scheduling + evidence logging (E-25), `createCardForFinding` pin behavior (E-9), Compare (E-21), slips dossier (E-20), `lib/findings-model.ts` as the findings authority (E-17). No schema change — if you reach for a migration, stop and reconsider (re-derive at display instead) or report `blocked`.
- **No model calls, no money, no new deps.** Everything derives from existing finding fields. If a good meaning-first front genuinely can't be derived for some finding shape without a model, degrade gracefully (e.g. a category-cued prompt) and note it — do not add a model call in this milestone.
- Hooks armed; Conventional Commits; 500-line/file; no `data/`/`.env*`. Verify against a throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`. DESIGN.md binding.

## Out of scope

- The optional **strict-hide toggle** (D-18 defers it "until someone asks") — do not build it.
- Any change to Compare or the slips dossier (criterion 5).
- Knowledge/composer/lexicon/tutor work (E-26+/v0.5); analysis or money paths; new nav or the two-tab shell (E-30).
- A translation/gloss model call, or a schema migration.

## Exit report
<!-- Append per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands, incl. the
     front-omits-error and report-correction-first assertions) / Tests changed-removed (read as
     specs, D-14) / Risks / Blocker. Verify against DISPOSABLE state. -->

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/new/feat/correction-forward (branch feat/correction-forward)
Changed:
  - lib/cards-view.ts: added the pure correction-forward derivation — `deriveFront` (a context gap: blank the changed span of the correction, keeping correct context; degrade to a `____ · category` cue when no localized change) and `deriveFaces`; new `CardView`/`CardBrowserView`/`CardFaces` shapes ({front, correction, why, error}); kept `cardBack`/`splitBack` for the stored column.
  - lib/cards.ts: display views now re-derive faces from each card's JOINED finding at read time — `listDueCardViews`/`listCardBrowserViews`/`getCardView`/`listCardsCsv`; replaced the old Card→view mappers. Storage (front=quote, back=cardBack) and all writes (generateCards, createCardForFinding pin) are byte-unchanged — no migration, no backfill, existing cards flip automatically.
  - app/api/cards/route.ts, .../[id]/grade/route.ts, .../export/route.ts: use the new correction-forward readers.
  - components/flashcard.tsx: front shows the meaning-first cue; back headlines the correction + why, shows the error once (data-card-error, red + strikethrough = meaning, D-14), Compare (E-21) unchanged.
  - app/practice/cards/page.tsx: browser rows lead with cue + correction, error shown once and marked.
  - components/revealable-error.tsx (new): tap-to-reveal; the error is absent from the DOM until revealed.
  - app/phrasebook/page.tsx: rows lead with the correct form; the error sits behind RevealableError; search + pin (createCardForFinding) unchanged.
  - components/analysis-report.tsx: rows lead with the correction (data-finding-correction); expanded detail shows why then the quote once, marked (data-finding-error); counts/expand/jump-to-audio unchanged. Exported FindingRow + defaultOpen for render tests.
Verified (against a throwaway ERIKA_DATA_DIR/ERIKA_DB_PATH, never data/erika.db):
  - `npm run typecheck` → clean. `npm run lint` → no warnings/errors. `npm run build` → succeeds.
  - `npm run test` (vitest, disposable DB) → 523 passed with `--no-file-parallelism`; a plain run shows the same except tests/analysis-concurrency.test.ts intermittently times out under parallel load — pre-existing, untouched by this milestone, passes in isolation (2.6s).
  - Criterion assertions proven: tests/cards-view.test.ts — `deriveFront` never contains the raw quote nor the wrong token; tests/correction-forward-render.test.tsx — front omits the error while the back marks it (line-through+severe) with Compare intact, the report leads with correction and shows the quote once beneath (marked, correction index < quote index), the reveal hides the error by default and shows it once on reveal; tests/cards-route.test.ts — the due view's front never contains its `error`, and the CSV export carries the error only on the Back ("You said: …") escaped, never the Front.
Tests changed/removed:
  - tests/cards-route.test.ts: updated the two view-key-shape assertions to the correction-forward shape and added front-omits-error checks; rewrote the export test to assert the error rides the escaped Back and is absent from the Front (its original RFC-4180 escaping intent preserved). No tests removed.
  - tests/cards.test.ts, tests/cards-csv.test.ts, tests/phrasebook.test.ts: unchanged — the data layer and the pure CSV serializer are untouched.
  - e2e (not in the gate; updated for coherence): flashcards.spec (seed shares context so cloze fronts differ), phrasebook.spec (assert correct-form-leads + tap-to-reveal), analysis-ui.spec (correction leads, error on expand), flashcards-manage.spec (escaping now exercised via the error on the Back).
Front-derivation approach: re-derived at display time from the card's JOINED finding (cards carry findingId) — no migration, no stored-front backfill; the `cards.front/back` columns still hold the finding copy generation wrote but display no longer reads them, so existing cards flip too.
Risks: the degrade path (`____ · category`) yields a low-context card for whole-sentence rewrites / deletions / identical (pronunciation) recasts — acceptable and noted per the WO's "degrade gracefully, no model call"; a future lexicon/gloss pass (E-26+) could enrich these. No schema change; Compare (E-21), the slips dossier (E-20), FSRS scheduling + evidence (E-25), and the createCardForFinding pin (E-9) are behaviorally unchanged.
Blocker: none.
