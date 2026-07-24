# WO-lesson-formats — E-32: lesson formats v1 (grammar + vocabulary, from the composer)

Target repo: immaculatecross/erika · Branch: `feat/lesson-formats` · **Review tier: Full**
<!-- Full: MODEL CALLS on the MONEY PATH (budget-capped, reserve-before-call, cached, ledgered —
     never-waivable: unrecorded spend / cap breach) + writes to the append-only EVIDENCE log +
     D-18 (no erroneous form as a stimulus). Every money invariant must be reconfirmed. -->

## First action (interrupt-hardening)
Branch `feat/lesson-formats` off latest `master`; empty commit + `git push -u origin feat/lesson-formats` first.

## Boot
`STATE.md` → `FEATURES.md` (E-32 row) → `DECISIONS.md` (**D-18** error-once/meaning-first; **D-19** evidence; **D-20** spend; **D-23** italiano colto) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` (binding — lesson/exercise UI) → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read what you build on: **E-6 lesson infra** (`lib/lessons/*`, `app/api/lessons/*`, patterns/mastery, caching), the **composer** (`lib/compose.ts` — the item selection you generate lessons for), the **money path** (`reserveSpend`/finalize, `rates.ts`, the cap, cross-biller guard), the **evidence** write path (`lib/knowledge/evidence.ts` `recordEvidence`, cued/production modes, morph-it validated IDs), and `lib/findings-model.ts` (E-17 authority).

## Objective
The composer's chosen items become **generated micro-lessons** the learner can actually do: **grammar** (rule explanation + short meaning-first exercises) and **vocabulary** (intro + practice), **colto-aware** (register per D-23, default colto), **budget-capped and cached like E-6**, and **completing an exercise writes evidence** (polarity + cued mode) so practice feeds the knowledge core. No lesson ever shows an erroneous form as a stimulus (D-18).

## Acceptance criteria
1. **Grammar micro-lessons for composer-chosen `rule:` items.** For a rule the composer surfaces, generate a concise **rule explanation** (correct, colto-aware, D-23) + **short meaning-first exercises** (multiple-choice / fill-in / rewrite, graded with feedback like E-6). Prompts are **meaning-first**: an English gloss or an Italian *context* gap — **never the learner's own erroneous form as the stimulus** (D-18). Colto register injected (D-23, default colto). A fixture test asserts a generated grammar lesson's shape (explanation + ≥N exercises, each with a correct answer + rationale) and that no exercise stem is an error form.
2. **Vocabulary intro + practice for composer-chosen `lemma:` items.** For a lemma at the knowledge edge, an **intro** (meaning, a correct example in colto register) + **practice** (recognition→production exercises). Meaning-first fronts (D-18). **[RETRO-002 P4] Gloss-fallback for degraded clozes:** when a cloze target is not inferable from context (e.g. a whole-phrase rewrite or a register upgrade where the target word isn't derivable), attach a short **English gloss** to the front so the cue is answerable (D-18 explicitly permits an English-gloss front). A test covers the degraded case producing a gloss, not an unanswerable `____`.
3. **Budget-capped, cached, ledgered — every money invariant (never-waivable).** Lesson generation is a billable model call: it **reserves before the call** (`reserveSpend`, pending counts against the cap so the pool can't overshoot), **finalizes to real cost on resolve** (recompute from response `usage` where available), **caches per item like E-6** so re-opening a generated lesson makes **zero** model calls and bills **zero**, and **refuses truthfully at the cap** (a truthful message, no silent spend). Estimates shown before generation stay truthful. Tests: a cache hit bills nothing (one ledger row per generation, not per open); the cap refuses at the limit; a parse failure still ledgers the charge (E-16 invariant). **No unrecorded spend, no cap bypass.**
4. **Completing an exercise writes evidence (polarity + cued mode).** A graded exercise writes an `evidence` row through the E-25 path on a **morph-it-validated / valid rule** ID: polarity from correctness, **mode = cued** (not spontaneous, not recognition-only where production was required — set the mode honestly so D-19 corroboration stays correct). Evidence stays append-only; derived state rebuilds. A test asserts a completed exercise writes exactly one correctly-typed evidence row and updates derived state; a wrong answer writes a negative-polarity row.
5. **No model call in the sandbox — build to fixtures, gate the real smoke.** There is **no `OPENAI_API_KEY`** here. Build the generation behind the existing model-client seam and **fixture-test** the parse/shape/caching/evidence/money mechanics deterministically (mirror E-4/E-6's fixture approach). Document the **one real-API smoke run** as an **operator-key-gated follow-up** in the PR (like E-4's documented smoke) — do NOT fake a smoke. Verify all mechanics against **disposable** state with a stubbed model.
6. **Gates + ritual.** `lint`/`typecheck`/`test`/`build` + tripwires green; DESIGN-faithful lesson/exercise UI (Motion/Lucide, calm, D-18 correction-forward at feedback); no schema change unless you add a lesson-cache column (if so: migration **v20** + `docs/schema.md` same PR). **Solo milestone — do the FEATURES/STATE ritual IN THIS PR** (E-32 → done, regenerate STATE).

## Files and constraints
- Likely: `lib/lessons/*` (generation for rule + lemma items, colto prompt, cache), `app/api/lessons/generate` (extend), the exercise-grade → evidence bridge, lesson/exercise UI under Learn. Reuse E-6 caching + the reserve-before-call biller; do not fork a second money path.
- Contracts that must not break: the cap stays hard cross-biller (E-28); `evidence` append-only; `lib/findings-model.ts` authority; `knowledge_items` rebuildable; cached lessons never re-bill. Conventional Commits; hooks armed; 500-line/file; disposable state only; never commit `data/`/`.env*`.

## Out of scope
- Pronunciation drill *scoring* (E-37 / Azure) and routing pronunciation items to a studio (E-37) — E-32 covers grammar + vocabulary. The tutor (E-34), voice/canon + register-dial *Settings* (E-33). The streak/map (E-38).

## Exit report
Append to the WO per `task.md`: RESULT / PR / Changed / Verified (exact commands + the money-invariant tests + the evidence-write test + the fixture-lesson shapes; note the deferred real-API smoke) / Tests / Risks / Blocker.
