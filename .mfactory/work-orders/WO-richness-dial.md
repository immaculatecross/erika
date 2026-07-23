# WO-richness-dial — The richness dial (E-28)

Target repo: immaculatecross/erika · Branch: `feat/richness-dial` · **Review tier: Full**
<!-- Full, never skippable: MONEY (rates recalibration + default cap rise), the ANALYSIS
     correctness path (a new short-capture deep path + enriched prompt/parse), a MIGRATION,
     and it writes production EVIDENCE. Do not lower. -->
<!-- Batch: solo. Builds on E-25 (evidence + morph-it validator) and E-27 (parallel cascade,
     reserve-before-call) — both merged. -->

## Objective

Spend where the signal is (D-20). A **short capture (≤ configurable minutes, default 30)** skips triage and is **deep-listened 100% at native speed** with an **enriched prompt** (pronunciation suspects, *italiano colto* register upgrades, disfluencies) — the mini's job was to save money on long dumps, and a 10-minute deliberate recording doesn't need saving. **Day dumps keep the cascade** (mini triage → deep only on flags), with triage **loosened** so more borderline speech reaches the deep model (D-20). The deep pass now also returns **correctly-produced lemma+POS** — validated against E-25's morph-it and written as **×0.7-discounted spontaneous-correct `evidence`** (Record teaches the model the user's real vocabulary, not only errors); recording-attested lemmas are marked so the future composer excludes them from new-item selection. `rates.ts` is **recalibrated to ~$0.03/audio-minute all-in** and the **default cap rises** to match the posture; pre-run estimates stay truthful and cached segments still never re-bill. This is the milestone that opens spend — it lands only because E-27 made the cap hard under concurrency.

## Acceptance criteria

1. **Short-capture full-deep path.** A session whose analysed speech is ≤ a configurable threshold (env, e.g. `DEEP_FULL_MAX_MINUTES`, default 30) **skips triage and deep-listens every segment** at native speed with the enriched prompt. Above the threshold, the existing cascade runs unchanged except triage is **loosened** (more segments flagged — a tunable knob, e.g. a lower flag bar / higher `assumedFlagRate` companion; state the default and that it's conservative, D-13). A test proves a short session makes deep calls on 100% of segments (zero triage calls) and a long one still triages then deep-listens only flags. Cached segments make zero calls in both paths (unchanged).
2. **Enriched prompt + persisted enriched output.** The deep prompt gains pronunciation-suspect flagging, colto register-upgrade suggestions, and disfluency notes. The enriched output **persists** — choose in this PR **either** new finding categories (extend `CATEGORIES` + a migration widening any constrained column) **or** a structured notes channel on findings (a JSON/notes column) — and say which and why in the PR. Deep **max-output-tokens rises** so the E-16 truncation-repair path stays rare (keep the repair; just make it seldom needed). Parsing stays defensive: a malformed/partial enriched reply still isolates to one segment (E-16 d4), never fails the run.
3. **Production lemma evidence.** The deep reply may return correctly-produced `lemma+POS` tokens; each is **validated against E-25's morph-it validator** (`lib/lexicon/morphit.ts`) and, if attested, written as `evidence` with `source='finding'`(or a suitable source), `polarity=1`, `mode='spontaneous'`, `weight` ×0.7 (audio-derived) — through the same knowledge write path E-25 built, on validated ids only, and **only within the E-17 included-finding scope**. An unattested/garbage lemma is dropped, never minted (D-13). Recording-attested lemmas are marked so a later composer excludes them from new-item selection (persist the mark; the composer itself is v0.5 — do not build it). A test covers: a valid produced lemma → one discounted spontaneous-correct evidence row on a validated id; an invalid one → no row.
4. **Rates recalibrated; default cap raised — truthfully.** `lib/analysis/rates.ts` audio numbers are recalibrated toward **~$0.03/audio-minute all-in** per D-20 (the deep model ~3× cheaper than the current ledgered figure; document the basis in-comment as the founding-era numbers already are — these remain the single price knob, still an explicit approximation to re-tune against real `usage`). The **default `monthlyBudgetUsd` rises** to match the richer posture (state the new default). The pre-run **cost estimator stays truthful** — the estimate and the recorded actual are still computed the same way, and the short-capture path's 100%-deep cost is reflected in the estimate a user sees before running. A test asserts the estimator matches the new path's real billed set and cached segments are never re-billed.
5. **Tracked E-28 pre-reqs (from the E-25 and E-27 reviews — fix them here, where they first bite):**
   (a) **Deploy-safe morph-it asset load** — replace the `process.cwd()`-relative read in `lib/lexicon/morphit.ts` with a load that survives a Next.js standalone/production build (bundle/trace the asset, or resolve relative to the module), since E-28 is the first milestone to run the validator on a real analysis path. A test/where feasible a build-trace assertion covers it.
   (b) **Cross-biller pending-aware budget guard** — the other billers (E-21 renditions, E-23 ask) gate on the committed-only `wouldExceedBudget`, blind to the cascade's in-flight pending reservations; now that this milestone opens spend, make their guard count **committed + pending** (reuse E-27's `reserveSpend`/accounting or a shared committed+pending read) so a concurrent cross-biller commit cannot push committed spend over the cap. A test spawns a cascade reservation + a concurrent ask/render against a tight cap and asserts committed never exceeds it.
6. **Migration + schema doc (if a migration is used).** Any schema change (enriched categories/notes, or an attested-lemma mark) lands as migration **v16**, documented in `docs/schema.md` in the same PR (`tests/migrations.test.ts` enforces). Additive; shipped-once; throwaway DB only.

## Files and constraints

- **Changed:** `lib/analysis/cascade.ts` (short-vs-long branch, loosened triage, lemma-evidence write), `lib/analysis/audio-model.ts` (enriched deep prompt + parse, higher max-tokens), `lib/analysis/findings.ts` and/or `lib/analysis/rates.ts`/`cost.ts` (enriched persistence + recalibrated rates + estimator), `lib/settings.ts` (default cap), `lib/lexicon/morphit.ts` (deploy-safe load), `lib/analysis/budget.ts` + the ask/rendition billers (pending-aware guard). Migration v16 + `docs/schema.md` if schema changes. Knowledge write via `lib/knowledge/*` (E-25).
- **Money-safety (never-waivable, D-15):** committed spend never exceeds `monthlyBudgetUsd` (now including the cross-biller path); exactly one committed row per charge; cached segments never re-bill; the estimate never *understates* the path's real cost. If any can't hold, `blocked`.
- **Contracts that must not break:** E-27's reserve-before-call/atomicity and E-4-c5 atomic commit; E-25's morph-it-validated-ids-only and the append-only evidence log; `lib/findings-model.ts` as the findings authority and the E-17 scope for any evidence bridge; the E-16 defenses (one bad segment isolated, parse-fail still bills, crash-resume). DESIGN.md for any report copy (quiet, exact).
- **D-13:** the ≤30-min threshold, the loosened-triage bar, and the recalibrated rates are tunable knobs — state defaults + that they're approximations to re-tune against real `usage`; the enriched parser handles the real distribution of model output (truncation, prose, missing fields) defensively.
- Hooks armed; Conventional Commits; 500-line/file; no `data/`/`.env*`. **No live API key** — tests inject a mock `AudioModelClient` returning enriched shapes + produced lemmas; make zero real calls. Verify against a throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`.

## Out of scope

- The **daily composer / new-item selection** itself (v0.5, E-31) — E-28 only *marks* recording-attested lemmas for it; it does not build selection.
- The **lexicon import & grammar syllabus** (E-26) — E-28 validates produced lemmas against morph-it (E-25), it does not need the frequency lexicon.
- Correction-forward UI (E-29), any Learn-tab/nav, Azure pronunciation scoring (E-37 — E-28 only *flags* pronunciation suspects in text, no scoring).
- Changing the concurrency/reservation mechanism (E-27) beyond the cross-biller guard fix in criterion 5b.
- A real-API smoke run (no key; the mock covers parsing — note in the PR that a real smoke run is owed when a key exists, mirroring E-4's documented smoke).

## Exit report
<!-- Append per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands) /
     Tests changed-removed (read as specs, D-14) / Risks / Blocker. Verify against DISPOSABLE
     state. If opening spend can overshoot the cap on any path, that is a blocker. -->

RESULT: done
PR:       feat/richness-dial → master (immaculatecross/erika)
Changed:
- lib/analysis/rates.ts — deep recalibrated $0.06→$0.03 (gpt-audio $0.10→$0.05, ~half per D-20); assumedFlagRate 0.3→0.5 (loosened-triage companion); new deepFullMaxMinutes() knob (default 30, DEEP_FULL_MAX_MINUTES).
- lib/settings.ts — default monthlyBudgetUsd 25→50 (richer posture, D-20).
- lib/analysis/cascade.ts — short-vs-long branch (isFullDeepSession over total speech, decided once/run); full-deep path skips triage and deep-listens 100%; deepListenSegment persists then records produced-lemma evidence; toTimeline carries notes. Money helpers extracted to reserved-call.ts (500-line hook).
- lib/analysis/reserved-call.ts (new) — BudgetHalt + reservedCall + withRepair (unchanged E-27 logic, moved out).
- lib/analysis/prompts.ts (new) — triage/deep prompt builders moved out (500-line hook), re-exported from audio-model; triage bar loosened; deep prompt gains pronunciation-suspect / colto-register / disfluency notes + a produced-lemma list.
- lib/analysis/audio-model.ts — DeepResult gains optional produced + per-finding notes; parseProduced (defensive); max_completion_tokens wired (DEEP_MAX_OUTPUT_TOKENS 4000, TRIAGE 400).
- lib/analysis/findings.ts — FindingNotes type; sanitizeNotes/parseNotesColumn; notes column threaded through persist + cache-reuse.
- lib/analysis/produced-lemmas.ts (new) — morph-it-validated produced lemmas → ×0.7 spontaneous-correct finding-sourced evidence via E-25 write path.
- lib/analysis/cost.ts — estimateCost full-deep mode (0 mini, 100% deep).
- lib/knowledge/{derive,items,types,index}.ts — derived recording_attested mark (rebuildable from the log).
- lib/lexicon/morphit.ts — deploy-safe module-relative asset load (import.meta.url, not process.cwd()).
- lib/render/engine.ts, lib/ask/engine.ts, lib/lessons/{billing,generate,grade}.ts — reserve-before-call so cross-biller spend counts committed+pending (criterion 5b).
- lib/migrations/v16-richness-dial.ts + index — findings.notes, knowledge_items.recording_attested; docs/schema.md updated (v16).
- app/api/sessions/[id]/analysis/estimate/route.ts — full-deep-aware estimate + fullDeep flag.
- Enriched persistence choice: a NOTES CHANNEL (findings.notes JSON) over new categories — enrichment is orthogonal to the error category, and widening the closed CHECK would touch every category-switching surface (Focus/slips/lessons/cards); a nullable JSON column is additive and isolated.
Verified (all against throwaway ERIKA_DATA_DIR/ERIKA_DB_PATH — never data/erika.db):
- npm run test → 71 files / 512 passed (incl. new tests/richness-dial.test.ts, 17). Money proof: "full-deep estimate equals the run's real billed set" (estimate.totalUsd ≈ monthToDateSpend, miniUsd=0) and cached re-run bills nothing; "cross-biller pending-aware cap" (a pending cascade reservation makes a concurrent render refuse; committed stays ≤ cap; reverse direction too); concurrency cap-hard test still halts at exactly the cap. Validated-lemma-evidence: attested→one 0.7 spontaneous row + recording_attested; unattested→none. Deploy-safe load proven cwd-independent (process.chdir away from repo).
- npm run lint (clean), npm run typecheck (clean), npm run build (Compiled successfully).
Tests changed/removed:
- tests/analysis-cascade.test.ts, analysis-recurrence.test.ts, analysis-unreadable.test.ts, analysis-concurrency.test.ts — run helpers pinned to deepFullMaxMinutes:0 so their CASCADE specs still exercise triage→deep (a short test session would otherwise take the new full-deep path). No assertion weakened; full-deep gets its own tests.
- tests/analysis-cascade.test.ts — deep cost assertion 0.06→0.03 (recalibrated rate).
- tests/analysis-route.test.ts, honest-home-routes.test.ts — default cap 25→50 (D-20). No tests deleted.
Risks:
- Produced-lemma evidence is written AFTER the findings+witness txn commits (recordEvidence runs its own txn + rebuild), so a crash in that narrow window loses that segment's positive evidence (findings/spend/witness are safe; a re-run is a cache hit that does not re-emit it). Enrichment is best-effort, not money (D-13).
- Rates are an approximation (no live key): a real-API smoke run against actual `usage` is OWED once a key exists, mirroring E-4's documented smoke — the mock covers parsing/shape only.
- morph-it deploy-safety uses module-relative resolution (import.meta.url); for a future Next standalone build the nft tracer must copy the asset — verified cwd-independent here, not yet in a standalone bundle (laptop era, E-40).
Blocker: none.
