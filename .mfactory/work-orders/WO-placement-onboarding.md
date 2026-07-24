# WO-placement-onboarding — E-35: placement onboarding (opens v0.6)

Target repo: immaculatecross/erika · Branch: `feat/placement` · **Review tier: Full**
<!-- Full: seeds evidence into the knowledge model (correctness — must NEVER mint `known`, D-19),
     a migration for the enrollment take, and it seeds LEVEL which changes what the composer
     surfaces. Psychometric scoring must be honest (D-13). -->

## First action
Branch `feat/placement` off latest `master`; empty commit + `git push -u origin feat/placement` FIRST. **`git add` this WO file in your first real commit.**

## Boot
`STATE.md` → `FEATURES.md` (E-35 row) → `DECISIONS.md` (**D-19** evidence/never-known; **D-22** on-device privacy; **D-24** calm; **D-13** fixtures prove judgment) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` (binding) → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read: the **evidence door** (`lib/knowledge/evidence.ts` `recordEvidence`, `EvidenceMode` — note `mode:'recognition'` is **status-only, never FSRS, never `known`** per `derive.ts:35,155`), the **lexicon** (`lib/lexicon/frequency-lexicon.ts` `freq_rank` + `rankToBand`), the **composer's** new-item selection (`lib/compose.ts` — reads item `status`; today everything is `unseen`, so a mid-level learner gets A1 day-1, the RETRO-003 defect this fixes), the **capture→ingest** path (`<Recorder>`, `createSession`, `finalizeStagedUpload`), and how sessions are stored.

## Objective
A first-run (and re-runnable) **placement** that, in 3–4 minutes and **with zero model calls for scoring**, estimates the learner's level and **seeds recognition-only evidence** so the daily composer starts new items **near the learner's level** (not at A1). It also captures the material E-36 needs: an optional short speaking sample (analyzed like any session) and a clean ~45 s **enrollment take** stored for speaker attribution.

## Acceptance criteria
1. **Yes/no vocabulary check — real words + pseudowords, response-style-corrected scoring (pure + unit-tested).** Present a timed set: **real Italian words sampled per frequency band** (from the E-26a lexicon via `freq_rank`/`rankToBand`, spanning A1→C2) **interleaved with pseudowords** (phonotactically-plausible Italian non-words — original, license-clean; a small committed list or a documented generator, NOT real lemmas). The learner marks each "know it / don't." A **pure scoring function** estimates, per band, the recognized proportion **corrected for yes-bias using the pseudoword false-alarm rate** (standard yes/no vocab correction — state the formula, e.g. corrected = (hit−fa)/(1−fa), and clamp to [0,1]); derive a coarse level (the highest band still reliably recognized). **Unit-tested with fixtures (D-13):** a pure-guesser (says yes to everything, incl. pseudowords) scores ~0 recognized, not "advanced"; a realistic responder recovers the seeded band; false-alarm correction actually moves the estimate. If the mapping is uncalibrated, say so and degrade truthfully.
2. **Seed recognition-only evidence — NEVER `known` (D-19).** For real words the corrected estimate says the learner recognizes, write **`mode:'recognition'` positive evidence** on the lemma's `knowledge_items` id via `recordEvidence`, moving them to **`introduced`** (a test asserts these items reach `introduced`/`introduced`-family status but **never `known`**, and that `derive.ts` still forbids recognition-only `known`). Only seed genuinely-recognized words (don't blanket-seed a band). The composer then starts new grammar/vocab near the learner's edge — **a test proves a post-placement `compose(day)` does NOT hand an A1 alphabet lesson to a learner placed at, say, B1** (the RETRO-003 fix, verified end to end).
3. **Optional 60–90 s speaking sample → normal capture→analysis.** An optional spoken prompt records through the **existing capture→ingest** path and lands as a normal session (analyzed like any other when a key exists; in the sandbox it stops at the honest missing-key wall). No separate analysis channel (E-17).
4. **Records the ~45 s enrollment take, stored for E-36.** Capture a clean ~45 s voice take and **store it with metadata** for E-36's speaker attribution (audio under `data/` per convention; a DB record). Migration **v22** adds the enrollment record (`docs/schema.md` same PR; `tests/migrations.test.ts` enforces). The take is stored, re-recordable, and never analyzed as findings (it's enrollment, not a session) — or if it doubles as the speaking sample, state that clearly. **On-device only (D-22): enrollment audio never leaves the device.**
5. **The flow, DESIGN-faithful (D-24).** A calm placement UI (Learn first-run / a Settings entry to re-run): the rapid yes/no check, the optional speaking prompt, the enrollment take, one factual completion line — no gamification, no confetti (D-24), Motion/Lucide only. Re-runnable (re-placement supported).
6. **Gates + ritual.** `lint`/`typecheck`/`test`/`build` + tripwires green; migration **v22** + `docs/schema.md`; **solo milestone — do the FEATURES/STATE ritual IN THIS PR** (E-35 → done, regenerate STATE one screen). No `OPENAI_API_KEY` in the sandbox — the scoring/seeding are model-free (test fully); the optional speaking-sample analysis is the honest missing-key wall (documented).

## Files and constraints
- New: `lib/placement/*` (the pure scoring + band/level logic + the pseudoword asset/generator), `lib/knowledge/seed-placement.ts` (recognition-evidence seeding), the enrollment store + migration `lib/migrations/v22-*.ts`, the placement UI under Learn/onboarding, a re-run entry in Settings. Changed: `docs/schema.md`.
- Contracts that must not break: `evidence` append-only; **recognition evidence never yields `known`** (D-19); `lib/findings-model.ts` authority; `knowledge_items` rebuildable; the composer's selection logic unchanged (it just now has seeded status to read). No money path touched (scoring is model-free). Conventional Commits; hooks; 500-line/file; disposable state (throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, NEVER `data/erika.db`); never commit `data/`/`.env*`; keep any committed pseudoword asset modest + license-clean.

## Out of scope
- **Speaker attribution / verification itself (E-36)** — E-35 only *captures + stores* the enrollment take; do NOT build sherpa-onnx embeddings/centroids/filtering. Pronunciation studio (E-37), streak/map (E-38). A "what Erika knows about you" surface (operator-deferred).

## Exit report
Append here per `task.md`: RESULT / PR / Changed / Verified (commands + the scoring unit tests incl. the pure-guesser + false-alarm-correction cases + the post-placement compose-not-A1 test + the never-`known` test + migration v22) / Tests / Risks / Blocker.

---

## Exit report

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/56 (`feat/placement` → `master`)
Changed:
- `lib/placement/scoring.ts` — pure, model-free yes/no scoring; pseudoword false-alarm correction `(hit−fa)/(1−fa)` clamped; level = highest reliably-recognized band; `calibrated` degrades truthfully.
- `lib/placement/pseudowords.ts` — 50 original, license-clean Italian non-words (none attested by morph-it, test-guarded).
- `lib/placement/check.ts` — deterministic per-band real-word sampling + pseudoword interleave.
- `lib/knowledge/seed-placement.ts` — recognition-only seeding (recognized words + sub-level grammar) → `introduced`, never `known`; idempotent re-run.
- `lib/placement/enrollment.ts` + `lib/audio-storage.ts` + migration `lib/migrations/v22-enrollment.ts` — `enrollment_takes` store (on-device only, D-22); `docs/schema.md` updated (latest v22).
- `lib/placement/status.ts` + `lib/today.ts` — placement/enrollment status; Learn first-run flag.
- `app/api/placement/route.ts`, `app/api/placement/enrollment/route.ts` — check/score/seed + on-device enrollment upload (no key touched).
- `app/practice/placement/page.tsx`, `components/placement/{vocab-check,enrollment-recorder}.tsx` — calm flow (D-24); Learn first-run entry (`app/practice/page.tsx`) + Settings re-run (`app/settings/page.tsx`).
- FEATURES.md E-35 → done; STATE.md regenerated (solo-milestone ritual).
Verified:
- `npm run typecheck` / `npm run lint` clean; `npx vitest run` → 736 passed (17 new).
- Scoring unit tests: pure-guesser scores ~0 (level null, not advanced); realistic responder recovers B1; false-alarm correction moves the estimate (fa 0.5 → B1 falls to A2); pseudowords non-attested in every POS (D-13).
- Never-`known` test: recognition-only reaches `introduced`, never `known` for both a lemma and a rule, incl. a 5-distinct-day recognition fold; `derive.ts` gate re-asserted.
- RETRO-003 compose test end-to-end: baseline `compose` offers `rule:alfabeto-suoni` (A1); after a B1 placement no A1 rule is offered; recognized words excluded from new-vocab.
- Migration v22 test; docs/schema tracks it.
- `npm run build` succeeds. Live disposable-server run (`ERIKA_DB_PATH`/`ERIKA_DATA_DIR` throwaway, `next start`): fresh-DB GET → 64-item check across all 6 bands (real webpack-bundle asset path); POST B1 answers → `level:B1`, 24 words + 173 rules seeded; DB = 197 `introduced`, 0 `known`; enrollment upload stored on-device with 0 sessions/ingest/analysis jobs; status → `placed:true, enrolled:true`.
Tests changed/removed: none removed. `tests/migrations.test.ts` gained a v22 case (additive).
Risks:
- Band→CEFR labels are a frequency proxy (not measured CEFR), surfaced honestly via `calibrated` + "rough placement" copy; uncalibrated until real placements accrue.
- Grammar seeding is blanket-by-level (no per-rule recognition signal) — deliberate; only marks sub-level rules `introduced` (never `known`, never prereq-satisfying, D-19).
- Optional speaking-sample analysis stops at the honest missing-key wall in the sandbox (no `OPENAI_API_KEY`), by design.
Blocker: none.
