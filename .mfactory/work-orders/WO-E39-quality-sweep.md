# WO-E39 — v0.7: the quality sweep

**This is not a debt tidy-up.** Operator, verbatim: *"most important is having extremely high quality product with all features working really well and delivering high quality service, with no bugs."* And: *"the o/a ending was just an example, we need to catch all mistakes be it grammar, vocabulary or pronunciation we can in the recording, and tutor."*

The authoritative finding list is `/workspace/mfactory-v2/runs/RETRO-004-adjudication.md` (22 findings, tiered). Supporting detail: `RETRO-004-product-lens.md`, `RETRO-004-technical-lens.md`, `REVIEW-60-money.md`, `REVIEW-64.md`. Process rules that apply to every workstream are in `/workspace/mfactory-v2/LOG.md` — **read the 2026-07-24/25 entries before writing code.**

## The five rules this version earned (they are binding here)
1. **Drive the built app; don't just read the diff.** E-37 shipped a page unreachable on every path while 958 tests passed and three Full reviews read the code. Verify user-facing work against a running built server on a fresh DB.
2. **Prove which server answered you** — bind an unusual port and confirm the responder is your own build. A verification silently hit another session's stale server and returned confident, wrong results.
3. **A test that cannot fail is worse than none.** Four shipped in v0.6. Expectations come from the fixture, never from the artifact under test; prefer asserting the positive; **mutate every guard and paste the failure.**
4. **Fix invariants, not instances.** Five repairs in v0.6 created their own mirror image. State the invariant, enumerate every path that violates it, and answer *"what does the opposite failure look like?"* before writing the fix.
5. **Check code against the project's own research/docs** before writing a constant. Two money defects were already documented correctly in `docs/research/` before the wrong number was written.

## Workstream A — catch every mistake (operator's live ask)
The product's core promise is finding the learner's mistakes. Make that comprehensive across **grammar, vocabulary and pronunciation**, in **both** the recording path and the tutor.
1. **Rebalance the tutor persona.** `lib/tutor/persona.ts` currently ranks final-vowel/agreement errors as the single highest priority, with grammar/word-choice third and vocabulary unnamed — because an operator *example* was encoded as the spec. Restructure so the mandate is **comprehensive**: catch grammar, vocabulary/word-choice, and pronunciation errors alike, with -o/-a agreement as **one worked example** of the final-vowel class rather than the headline. Keep every guardrail already in place: never invent an error, never infer from the learner's L1, never flag an acceptable variant, at most one correction per turn, no re-drilling, and the D-23 register composition. **Do not weaken the anti-nag or precision clauses** — comprehensiveness is about *coverage of what counts as a mistake*, not frequency of interruption.
2. **Audit the recording path for coverage gaps.** Read `lib/analysis/prompts.ts` (triage + deep), the findings category set (`lib/analysis/findings.ts`, the CHECK in migrations), the richness-dial `notes` channel, and `lib/findings-model.ts`. Answer concretely: **which classes of mistake can the analysis currently express, and which can it not?** Look specifically for vocabulary/word-choice coverage — is there a category for "wrong word, right grammar"? — and for anything the model is asked to notice but the schema then discards. Fix the gaps you find; where a gap needs a migration, append one.
3. **Prove coverage rather than asserting it.** Add fixture-based tests that a finding of each supported class survives the whole path end to end — prompt → parse → persist → surface — so a class silently dropped by a schema CHECK or a view filter fails a test. This is the guard the product's central promise currently lacks.

## Workstream B — Tier 1 user-visible defects (RETRO-004)
1. **A bystander's errors still become the learner's.** E-36 gates **positive evidence only**; `is_user` is read in two places under two different rules and `findings-model.ts` has **no speaker predicate**, so another person's mistakes become the learner's cards, slips and drills. *This is the half of speaker attribution that matters most for accuracy.* Respect D-22 recall-first (NULL = unattributed = the user) and E-17 (findings read through one gate).
2. **The "right now" walls.** Every `/practice/learn` row leads to *"The lesson model is unavailable right now"* — false for a permanent condition, **no retry control**, and the budget branch says "raise the cap in Settings" with **no link**. Make the copy true for both the transient and the permanent case, add retries, add the link. The keyless-ingest notice from `7a30878` is the standard to match.
3. **The studio drill cannot retire without a key** — `visitCounts: heard` requires a successful TTS playback, and a pronunciation finding has no card path, so it re-enters the plan every day forever. Give it a completion path that exists on the shipped default, and add the **server-side backstop** the visit route still lacks (today it accepts a bare POST from anything; this invariant has broken twice).
4. **`sessions.created_at` is the upload instant, not capture.** So "this morning's recording" is wrong for the headline day-dump case (record 08:10, upload 21:30), and Focus's local-hour histogram is wrong with it. Establish a real capture timestamp (from the upload, the file, or explicitly recorded at capture) and use it wherever the app makes a claim about *when the learner spoke*. **This is an invariant fix, not a field swap — enumerate every consumer.**
5. **Settings never mentions that an API key is required.** The only place a new user learns it is a leaked internal error string. Say it once, calmly, where it belongs.
6. **`pinFinding` reads `findings` raw with no inclusion gate** — violates CLAUDE.md's own E-17 rule and falsifies `findings-model.ts:223-228`.
7. Smaller, same class: *"N sounds at your edge"* promises a return no code path implements; `Said N×` counts a button press that permanently retires a correction; the `submit()` network-error fallback and any other place a failure is reported as a success.

## Workstream C — money truthfulness (a wrong charge is a quality defect)
From `REVIEW-60-money.md` and RETRO-004 Tier 2. **Direction rule, absolute: every rate must be at or above reality; unverifiable ⇒ round UP and say so on the line.**
1. **`gpt-audio-mini` bills its text tokens at $0** (F1) — the audio-input floor with no allowance for prompt/JSON, on the **most-used** money path.
2. **A legal 21-minute tutor call bills 1.9×** — `RESERVATION_STALE_MS` (15 min) < `maxTutorSessionMinutes()` (30 min), and the sweep runs at the top of **every analysis job**. Server-elapsed also resets to zero, disabling both the duration ceiling and the under-report floor.
3. **TTS is billed per input *character* at the audio-*output-token* rate** — ~1.3–1.6× under-priced, **and that figure is the reservation/cap check**. `spike-3:16` ordered this fix; only half landed.
4. **`gpt-audio` fallback priced 2.6× above the cited table**; the pre-run estimate is 40% below what a fallback run bills.
5. **Pin `rates.ts` to `docs/research/`** the way `tests/migrations.test.ts` pins `docs/schema.md` (F8) — the structural fix for the drift that caused all of this. **Extend floor tests to every rate**, not just the realtime six.
6. `finalizeReservation`'s "never lose a charge" fallback can **double-charge** a swept lease; `isAssumedRunLeaseHash` is exported, documented as authoritative, and **dead** (dropping its `pa:` clause passes 967/967).

## Workstream D — make CI able to see these defects (highest structural leverage)
1. **CI never runs the 12 existing Playwright specs.** Wire them into the `gates` workflow. This is why an unreachable page shipped. If the sandbox cannot install browsers, make the job installable/runnable in CI even if it must be skipped locally — and say clearly which environment runs it.
2. **Replace source-text assertions with behavioural ones.** E-37's regression test for v0.6's flagship defect asserts `expect(src).toContain("decodeURIComponent(...)")`: it **survives a double-decode** and **goes red on a behaviour-identical rename** — precisely inverted. Its helper round-trips the test's own encode against its own decode and never renders the page.
3. **Close the three surviving mutations**: the dead `isAssumedRunLeaseHash`, and the D-19 `known` gate's *two-distinct-days* and *≥1 spontaneous* clauses (each unasserted and deletable green). Note 7 killed mutations were caught by exactly **one** test each — single points of failure.
4. **One rule, two dialects** — `drillFitsShortAudio` vs `DRILLABLE_CORRECTION_SQL`; `isAssumedRunLeaseHash` vs `ASSUMED_RUN_SQL`. Make one authoritative or generate one from the other.
5. **Migrations are not intrinsically idempotent** — bare `CREATE TABLE`/`ALTER TABLE` everywhere except the v17/v18 seeds, so the ledger is the sole idempotency. One wrong row was unrecoverable.
6. Add a **failure-path walkthrough** alongside the cold-start one: for every surface, what happens on error / empty / cap-refused / missing key / transient failure — and is there always a way forward?

## Workstream E — honesty, design, and docs that mislead
1. The `known` gate's "non-audio corroboration" comment no longer means what it says; a failed review in the **same SQLite second** as the last correct one is invisible to the lapse gate.
2. Three hardcoded `#34C759` greens instead of the token; a focus ring switched off on the review card.
3. **`FEATURES.md` still labels E-39/E-40/E-41 with pre-amendment versions** (and contradicted its own header before v0.6's close). Correct them: v0.7 = E-39, v0.8 = E-40 + E-41.
4. Stale comments **only where they mislead a future fix** — internal tidiness ranks last, per the operator.
5. The fa-0.25 placement threshold may refuse a genuine yes-biased advanced learner with **no escape but retaking**. Consider a higher threshold or a "start me at the beginning / let me pick" escape.

## Constraints (all workstreams)
Preserve: `evidence` append-only (v14 triggers); recognition/cued never mints `known` (D-19); `lib/findings-model.ts` as the only findings gate (E-17); reserve-before-call + the hard cap + spend-recorded-on-crash; D-18 correction-forward; D-22 recall-first and on-device; D-24 calm (**no automated tripwire — review-only**); D-23 register composition. Never edit a shipped migration. Conventional Commits (**subject ≤72 chars**); 500-line/file; disposable DB only (`ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, **never** `data/erika.db`); never commit `data/`/`.env*`.

## The v0.7 gate is behavioural, not numeric
Not "N tests pass". A **cold-start walkthrough** and a **deliberate failure-path walkthrough**, both on the built server, with every dead end either fixed or explicitly recorded as accepted.
