# WO-daily-composer — E-31: the daily composer + day ledger (knowledge core's first live consumer)

Target repo: immaculatecross/erika · Branch: `feat/daily-composer` · **Review tier: Full**
<!-- Full: a schema MIGRATION (the day-completion ledger) + the FIRST production consumer of the
     E-25 knowledge core (reads knowledge_items status / freq_rank / rule DAG to select new items)
     + the D-19 corroboration correctness (what counts as "known"). Correctness-critical: a wrong
     `known` gate permanently hides a word from the learner; a wrong ledger makes the streak lie. -->

## First action (interrupt-hardening)
Branch `feat/daily-composer` off latest `master`; empty commit + `git push -u origin feat/daily-composer` first.

## Boot
`STATE.md` → `FEATURES.md` (E-31 row) → `DECISIONS.md` (D-19 knowledge model; D-24 habit layer) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` (binding — the Learn home + goal ring) → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read the knowledge core you're consuming: `lib/knowledge/derive.ts` (item status), `lib/knowledge/*`, `lib/lexicon/frequency-lexicon.ts` (`freq_rank`), `lib/syllabus/*` (the rule DAG), `spill_queue`, and how FSRS due/retrievability is computed (`ts-fsrs` usage).

## Objective
`compose(day)` builds the learner's daily plan from their own recorded material first, making **zero model calls**, and the Learn home renders TODAY over the E-30 shell. A **local-day goal-completion ledger** (migration) records every completed day from the start so E-38's streak is retroactively true. This is the knowledge core's first production reader, so it also lands the D-19 corroboration corrections the retro flagged.

## Acceptance criteria
1. **`compose(day)` is pure and unit-tested.** A pure function assembles, in priority order: **spill queue** (yesterday's overflow) → **FSRS-due reviews** (worst retrievability first) → **active slips** → **unspent findings** → **new items at the knowledge edge** (defaults **10 vocab / 3 rules / 10 pronunciation**, settable in Settings), interleaved sensibly, with **overflow spilling to tomorrow** (written to `spill_queue`). No model calls, no network, deterministic given the DB state + the day. Unit tests cover ordering, the interleave, the caps, and overflow→spill.
2. **New-item selection at the knowledge edge (reads the E-26 inventory).** Vocab new items are drawn by **`freq_rank`** (most-frequent-unseen first) from `knowledge_items` lemmas; grammar new items respect the **syllabus DAG** (a rule is only eligible once its prereqs are learned); pronunciation new items per the existing suspects. **Exclude** from new-item selection: items already `known`, and **recording-attested** lemmas (E-28 `recording_attested` — the user already produced them correctly). Tests assert the edge selection excludes attested/known and respects the DAG.
3. **[RETRO-002 P3/T3] D-19 corroboration is correct — the first surface reads `status`.** Fix `derive.ts` so **recognition-mode positives never count toward the `known` corroboration gate** (D-19: recognition-only is never "known"); only non-recognition production/drill positives corroborate. AND gate a slip's **"resolved"/green** on a **positive production or drill event**, not mere absence of recurrence (today green comes from "N sessions clean" alone — RETRO-002 P3). Add derive tests pinning both: a recognition-only item stays out of `known`; a one-off slip with no positive event is **not** green. (Green = mastery, D-14/D-24.)
4. **Local-day goal-completion ledger (migration).** A migration adds a day-completion ledger table (assign the **next version after v18 → v19**; update `docs/schema.md` in the same PR — `tests/migrations.test.ts` enforces). It records each completed day keyed by **local day** with an **explicit, documented timezone stance** (state it in code + schema.md). A day is "complete" when the day's goal is met; the ledger is written from day one so the streak is retroactively true at E-38. Idempotent; never double-counts a day. Derived/rebuildable where possible; if authoritative, say so. Tests: a completed day writes exactly one row; re-completion doesn't duplicate; the timezone boundary is covered.
5. **Learn home shows TODAY (DESIGN/D-24 binding), over the E-30 Learn tab.** The Learn home renders today's plan — **cards due, the lesson row** (the tutor row arrives with E-34; leave its slot), the **ink goal ring** (one ring, accent on hairline, closes on the standard spring — no second ring, no fill), and **one factual completion sentence once per day** ("Done for today. 9 cards, one lesson."). No confetti, no XP, no second celebratory beat (D-24). Integrate into the Learn tab shipped by E-30 (#49). Screenshots (light+dark) of the Learn home pre- and post-completion.
6. **[RETRO-002 T2] Knowledge-core yield instrumentation (de-risk this milestone's own inputs).** Add counters/observability for the produced-lemma pipeline — emitted vs morph-it-attested vs dropped — surfaced in a small **dev-only knowledge inspector** (or a logged summary), so a near-empty attestation yield is visible rather than silent. Cheap; it proves the composer's new-item exclusion has real data to act on.
7. **Gates green** (`lint`/`typecheck`/`test`/`build` + tripwires); zero model calls on the compose path; verify against **disposable** state; no money path touched. **The worker performs the FEATURES/STATE ritual IN THIS PR** (flip E-31 → done, regenerate STATE one screen) — this is a solo milestone, so the ritual rides in the milestone PR per CLAUDE.md (not deferred to the dispatcher).

## Files and constraints
- New: `lib/compose.ts` (pure composer) + tests; migration `lib/migrations/v19-*.ts` (+ wire `index.ts`) + `docs/schema.md`; Learn-home components under `app/practice` (or the E-30 Learn location); a dev knowledge inspector. Changed: `lib/knowledge/derive.ts` (corroboration), Settings (the new-item cap knobs), `app/practice` home.
- Contracts that must not break: `evidence` stays append-only; `lib/findings-model.ts` is the findings authority (E-17); `knowledge_items` derived state stays rebuildable from the log; the migration is additive + shipped-once. Motion/Lucide only (DESIGN); Conventional Commits; hooks armed; 500-line/file; never commit `data/`/`.env*`.

## Out of scope
- Lesson *generation/formats* (E-32), voice/canon + register dial (E-33), the tutor (E-34), the streak *rendering*/map (E-38 — E-31 only writes the ledger). A "what Erika knows about you" user-facing surface is the operator's deferred decision — the dev inspector here is NOT that (keep it dev-only).

## Exit report
Append to the WO per `task.md`: RESULT / PR / Changed / Verified (exact commands + the compose unit-test summary + the migration/ledger test + screenshots) / Tests / Risks / Blocker.

---

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/50  (branch `feat/daily-composer` → `master`)
Changed:
- `lib/compose.ts` — pure, unit-tested `compose(day)`: spill → FSRS-due (worst retrievability first) → active slips → unspent findings → knowledge-edge new items (10/3/10, settable), interleaved, overflow→tomorrow's spill; ZERO model calls; idempotent spill reconciliation. Pure core `composePlan` + DB glue.
- New-item selection reads the E-26 inventory: vocab by `freq_rank`, rules gated on the syllabus DAG, phones for pronunciation; excludes `known` + `recording_attested`.
- `lib/knowledge/derive.ts` — [P3/T3] recognition-mode positives no longer corroborate `known` (D-19).
- `lib/slips.ts` + new `lib/slip-standing.ts` (500-line extraction) — [P3] slip green (remission/resolved) gated on a positive production/drill event, not mere absence; DB glue supplies the flag (a passing card grade on the slip's findings).
- Migration **v19** `lib/migrations/v19-day-ledger.ts` — `day_ledger` local-day goal-completion ledger; `lib/day-ledger.ts` (idempotent, authoritative, derived goal); `lib/local-day.ts` (explicit timezone stance); `docs/schema.md` updated same PR.
- Learn TODAY home: `components/goal-ring.tsx` (one ink ring, hairline track, standard spring), reworked `app/practice/page.tsx`, `lib/today.ts`, `app/api/learn/today` (GET), `app/api/day/complete` (POST, authoritative).
- [T2] `lib/knowledge/yield.ts` + `lib/knowledge/inspector.ts` + `app/api/dev/knowledge` + `app/dev/knowledge` (dev-only, 404 in prod); `recordProducedLemmas` bumps emitted/attested/dropped.
- Settable new-item caps in `lib/settings.ts` + `app/settings/page.tsx`.
- Ritual: E-31 → done in FEATURES.md; STATE.md regenerated.
Verified:
- `npm run typecheck` ✓ · `npm run lint` ✓ (no warnings) · `npm run test` ✓ **613 passing** (+34) · `npm run build` ✓ (routes `/api/learn/today`, `/api/day/complete`, `/api/dev/knowledge`, `/practice`, `/dev/knowledge` all built).
- Compose unit tests: priority ordering, worst-retrievability-first, round-robin interleave, per-kind caps (spill counts first), overflow→spill (fresh only, never reviews/slips), and DB-level edge selection (freq_rank + cap), `known`/`recording_attested` exclusion, rule-DAG eligibility, spill drain + same-day idempotency.
- Migration/ledger tests: v19 shape + PK-idempotency; ledger records once / never double-counts; timezone-boundary (local-day straddling midnight, month/year rollover); derived goal met only when queue cleared after real work.
- Disposable-state e2e: throwaway `ERIKA_DB_PATH`, seeded corpus, real built server — `/api/learn/today` returned pre (ring 3/9, 6 due, 10 words/3 rules) and post (ring 9/9, "Done for today. 9 cards."); `/api/dev/knowledge` 404s in production; yield 4/3/1; status spread known 1 / learning 3 / unseen 30782 lemmas + 266 rules. Never touched `data/erika.db`.
- Screenshots: pixel screenshots NOT possible — the Playwright browser CDN (`cdn.playwright.dev`) is egress-blocked in this sandbox (`403 host not permitted`), a proxy policy denial not routed around. Substituted with (a) DOM render tests for the goal ring (one ring, stroke-only, data-complete flips) and (b) a faithful visual reference of all four states (light+dark × pre/post) built from the real composed data: https://claude.ai/code/artifact/ad2e7aa2-5eeb-4c8b-a8cb-1e9e6b95b2a3
Tests changed/removed:
- `tests/slips.test.ts` — two DB tests that asserted resolved/resolved-count from clean sessions ALONE now add a passing drill (`drillClean`) to earn green; they encoded the pre-fix contract (green from absence). Added a test pinning: clean streak with no positive event stays active; a failed drill (all `again`) is a lapse; a passing drill unlocks green.
- `tests/settings.test.ts` — the "persists all fields" exact-equality expectation extended with the three new-item-cap defaults.
- No tests deleted.
Risks:
- FSRS params remain uncalibrated defaults (pre-existing, truthful-degradation). Pronunciation new-item pool is empty until E-37 seeds phones (slot wired + tested). `dailyMax` is a composer constant (40), not a Settings knob — it only creates the spill pressure. A card re-graded `again` briefly counts in the ring denominator via `dueRemaining` but not in `done` (advanced-only) — no false completion; polish is E-38's ring rendering.
Blocker: none.
