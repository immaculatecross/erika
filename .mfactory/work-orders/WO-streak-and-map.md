# WO-streak-and-map — E-38: streak & map (the calm habit layer; closes v0.6)

Target repo: immaculatecross/erika · Branch: `feat/streak-and-map` off latest `origin/master` · **Review tier: Full**
<!-- Full: D-24 is binding and this is the milestone that most tempts a designer to break it (streaks are
     where gamification creeps in); it introduces a repair-credit ledger (a migration + a fairness rule);
     it makes a user-visible claim about "what you did today" that must be TRUE (D-19); and it fixes a
     known correctness bug (UTC-binned hours). There is NO automated tripwire for the D-24 ban list —
     enforcement is review-only, so the WO must be precise. -->

## First action
Branch `feat/streak-and-map` off latest `origin/master`; empty commit + `git push -u origin feat/streak-and-map` FIRST. **`git add` this WO file in your first real commit.**

## Boot
`STATE.md` → `FEATURES.md` (E-38 row — "the Learn map strip") → **`DECISIONS.md` D-24 in full** (the calm habit layer; note the mechanic: **two automatic silent repairs per month, earned not bought**) → **`DESIGN.md:42-49` + `:53`** (binding: goal ring / completion / streak caption style / knowledge-map green / the **ban list**) → `HANDOVER.md` → `CLAUDE.md` → `docs/schema.md` → `.mfactory/playbooks/task.md`.
Recon-verified anchors (trust these; don't re-derive):
- **Day ledger (your streak's source):** `day_ledger(local_day PK, completed_at, cards_done, lessons_done)` — `lib/migrations/v19-day-ledger.ts:31-38`. API `lib/day-ledger.ts`: `dayGoal` `:67` (met = `total>0 && dueRemaining===0`), `getDayCompletion` `:99`, `isDayComplete` `:107`, `recordDayComplete` `:118` (INSERT OR IGNORE), `completeDayIfMet` `:137`, **`completedDayCount` `:147` — its docstring already calls itself "the raw material for E-38's streak"**. **A row exists only when the goal was met.**
- **The local-day seam (single source of truth):** `lib/local-day.ts` — `localDay(at)` `:22`, `nextLocalDay(day)` `:31` (parses at local noon to survive DST), `isLocalDay` `:39`; stance comment `:1-20` (DB timestamps stay UTC; only the day KEY is local).
- **Today read model / home:** `buildToday` `lib/today.ts:38`, `TodayView` `:19-36`; route `app/api/learn/today/route.ts`; the existing single factual beat `completionSentence` `app/practice/page.tsx:27-31` → "Done for today. 9 cards, one lesson."; ring `components/goal-ring.tsx:15`; page wiring `app/practice/page.tsx:37-72,122-136`.
- **The map's real meaning (D-24/DESIGN):** *category cells tint toward green ONLY through resolved-slip semantics — green remains mastery, never mere activity* (`DESIGN.md:47`). Categories: `CATEGORY_ORDER` in `lib/analysis-view.ts`. Slip standing: `buildSlipsIndex` `lib/slips.ts:333` → `{slips, resolvedCount, remissionCount, activeCount}` `:207`, `resolvedSlipCount` `:350`, `computeSlipStanding` `lib/slip-standing.ts:46`, `SlipState = "active"|"remission"|"resolved"` `:13`. Existing focus surfaces to extend-not-duplicate: `lib/focus.ts` (`buildFocusPayload` `:234`), `components/category-bars.tsx`, `components/sparkline.tsx`, `components/slip-hours.tsx`.
- **Today's targets (never persisted!):** `compose(db, day, caps)` `lib/compose.ts:365` recomputes the plan every read and writes nothing but spill reconciliation (`:394-405`). Existing reducers over today's plan: `collectTutorTargets(db, day)` `lib/tutor/session-config.ts:111`, `buildLearnItems(db, day)` `lib/learn-items.ts:36`.
- **Produced evidence → recording linkage (E-36):** `producedSourceRef(sessionId, contentHash, lemma, pos)` `lib/analysis/produced-lemmas.ts:25` = `` `${sessionId}:${contentHash}:${lemma}#${pos}` ``; `evidence(item_id, source, source_ref, mode, polarity, session_id, created_at)` (append-only, v14 triggers); idempotency index `idx_evidence_produced_idem` (`lib/migrations/v23-speaker-attribution.ts:60-64`); speaker gate `segments.is_user` (NULL = unattributed = treat as user), `sessions.exclude_from_evidence`. `evidence.created_at` is **UTC text** — reduce to a local day with the existing pattern at `lib/day-ledger.ts:27,50-52`. **There is no "evidence on local day D" query today — you add one.**
- **Migrations:** master is at **v23**; **E-37 reserves v24** (in flight, parallel). **Take v25** and say so in the migration header, per the documented parallel-batch precedent (`lib/migrations/v18-syllabus.ts:20-23`). `tests/migrations.test.ts` enforces: a `| <version> | \`<name>\`` row, the literal `Latest version: v<max>.`, and every created table named in backticks in `docs/schema.md`.
- **UI conventions:** new Learn sub-view lives at `app/practice/<name>/page.tsx`; nav via `LEARN_SECTION` `lib/nav.ts:35-39` + `LEARN_PREFIXES` `:43` (anything under `/practice/*` is already covered). Motion: framer-motion only, `SPRING`/`pageVariants`/`stagger*` from `lib/motion.ts`, always paired with `usePrefersReducedMotion()`. Icons: Lucide only, `size={20} strokeWidth={1.5}`. Tokens from `tailwind.config.ts:11-21`; **`good` (#34C759) is reserved for mastery**. Charts are **hand-rolled — no charting library** (see `components/sparkline.tsx`, `components/slip-hours.tsx`). `data-*` attributes are the test hooks.

## Objective
The **calm habit layer**: a streak that rewards returning without ever punishing a miss, a **map strip** that shows real mastery (not activity), and a **"today's thread"** beat that connects today's practice to something the learner actually *said*. Plus the local-vs-UTC hour bug fix. Every pixel is D-24-bound: **no confetti, no celebration animation, no loss-aversion pressure, no "don't break the chain".**

## Acceptance criteria
1. **Streak with earned, silent repairs (D-24's exact mechanic).** Compute the consecutive-day run from `day_ledger` local-day keys (use `localDay`/`nextLocalDay`; never UTC). **Two automatic silent repairs per calendar month, earned not bought**: a single missed day inside an otherwise-continuous run is repaired **automatically and silently** (no prompt, no purchase, no "use a streak freeze?" modal), consuming one of the month's two credits; when credits are exhausted the run simply ends — **no guilt copy, no warning, no countdown**. Persist the repair ledger (**migration v25**: which local_day was repaired, when, and the month it was charged to) so repairs are auditable and idempotent — recomputing must never double-spend a credit or silently change history. **Pure, unit-tested logic** (a `lib/streak/*` module taking day keys → `{currentRun, repairsUsedThisMonth, repairedDays}`): tests must cover a clean run, a single gap repaired, a second gap in the same month repaired, a **third** gap in the same month that correctly ends the run, month rollover restoring credits, DST boundaries, and idempotent recomputation.
2. **Render it the way DESIGN says, and no other way.** Follow `DESIGN.md:42-49`: the "Day 14" caption style and the "repaired Tue" acknowledgement — factual, quiet, one line. **Banned (a reviewer will check by hand, there is no tripwire): confetti, celebratory animation, trophies/badges/points, streak-loss warnings or countdowns, red/alarm styling on a missed day, any nag.** Green (`good`) may NOT be used to mean "you showed up" — it is mastery only. Motion is `SPRING` + reduced-motion-aware.
3. **The map strip = mastery, not activity.** A compact Learn strip of the `CATEGORY_ORDER` cells tinting toward green **only via resolved-slip semantics** (reuse `buildSlipsIndex`/`computeSlipStanding` — do NOT invent a second notion of mastery, and do NOT tint by volume/frequency of practice). Extend the existing focus surfaces rather than duplicating them; hand-rolled, no chart library. A test asserts a category with lots of *activity* but no resolved slips does **not** tint green.
4. **"Today's thread" — and it must be TRUE (RETRO-003, D-19).** One factual beat that cites **the specific composer target the learner actually produced today** — e.g. "You practiced *X* today — and you used it in this morning's recording." Implementation: a new query for **evidence rows created on local day D** (reduce `evidence.created_at` UTC text via the `lib/day-ledger.ts:27,50-52` pattern), intersected with today's targets from `compose(db, day)` / `collectTutorTargets`. **Honesty requirements:** only cite **spontaneous production evidence from the learner's own speech** — respect E-36's gate (`segments.is_user = 0` excluded; NULL = unattributed = counts as user) and `sessions.exclude_from_evidence`; never cite a cued/recognition event as "you used it". If nothing qualifies, **show nothing** — do not manufacture a beat, do not soften with a generic encouragement. Tests: a genuine produced-lemma on a targeted item yields the beat; a bystander-attributed segment yields **no** beat; an excluded session yields **no** beat; a cued-only event yields **no** beat; no qualifying evidence yields **no** beat.
5. **Fix the UTC-binned hours bug (RETRO-003), with an explicit DST answer.** `lib/slip-hours.ts:52` uses `getUTCHours()`; the surrounding comment `:5-13` argues for UTC and the UI hard-codes it (`components/slip-hours.tsx:21,29` say "UTC"). Convert to the **learner's local hour** (D-24: the user's day is local), update those user-visible strings, and update the tests that pin UTC (`tests/slip-hours.test.ts:18,30,44,51,57`, `tests/slip-hours-render.test.tsx:11`) — **do not delete coverage; convert it** and justify each change (D-14). **You must answer the DST question the old comment raises, in code and in the PR**: state plainly what happens to the ambiguous/skipped hour and why that choice is acceptable. Prefer adding a local-hour helper to `lib/local-day.ts` to keep the one-seam invariant.
6. **Gates + ritual.** `lint`/`typecheck`/`test`/`build` + `.mfactory/hooks/run-tripwires.sh --all` green; **migration v25** + `docs/schema.md` same PR; **solo milestone — do the FEATURES/STATE ritual IN THIS PR** (E-38 → done, regenerate STATE one screen). **E-37 is building in parallel and reserves v24** — if it merges first, rebase onto `origin/master` and resolve the STATE/FEATURES/`docs/schema.md` overlap **without clobbering its content**; keep your migration at v25 regardless.

## Files and constraints
- New: `lib/streak/*` (pure run + repair logic), the repair-credit store + migration `lib/migrations/v25-*.ts`, the map strip component, the today's-thread query + beat, a local-hour helper in `lib/local-day.ts`. Changed: `lib/today.ts` / the Learn home (`app/practice/page.tsx`), `lib/slip-hours.ts` + `components/slip-hours.tsx` + their tests, `docs/schema.md`, FEATURES.md, STATE.md.
- Contracts that must not break: `evidence` append-only and read-only to you (**this milestone writes NO evidence**); `lib/findings-model.ts` is the only findings gate (E-17); the composer/knowledge core untouched; the day ledger's "row only when met" semantics unchanged; **no money path touched** (if you find yourself adding a billed call, STOP and report). Never edit a shipped migration. Conventional Commits; hooks; 500-line/file; disposable throwaway DB (`ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, NEVER `data/erika.db`); never commit `data/`/`.env*`.

## Out of scope
- A "what Erika knows about you" surface (operator-deferred, and the dev inspector at `lib/knowledge/inspector.ts:9-11` explicitly is not it). A syllabus-DAG/mastery-tree view (D-24's map means the category strip). Pronunciation studio (E-37). Notifications/reminders of any kind. Do NOT add a charting library.

## Exit report
Append here per `task.md`: RESULT / PR / Changed / Verified (exact commands + the streak tests incl. the third-gap-ends-run and month-rollover and DST cases + the map "activity ≠ green" test + all four today's-thread negative cases + the slip-hours local conversion with your DST answer + migration v25) / Tests (changed/removed — justify each, esp. the converted UTC tests) / Risks / Blocker.
**Also write your exit report to `/tmp/claude-0/-home-user-erika/3099ebc4-2226-5dc9-8bf4-f6efa564d8e2/scratchpad/E38-report.md` before returning** (durability — a completion notification may be lost).

---

## Exit report (filled)

```
RESULT: done
PR:     https://github.com/immaculatecross/erika/pull/62  (branch feat/streak-and-map → master)
```

## Changed

- **Migration v25 `streak_repairs`** (`lib/migrations/v25-streak-repairs.ts`, registered in `lib/migrations/index.ts`): the spent-repair ledger. `local_day` PK (the missed day bridged) + `charged_month` (stored, not re-derived, so the ledger stays auditable) + `created_at`. FK-free — a repair records a day the goal was *not* met, so there is no `day_ledger` row to point at (`spend_ledger` precedent). Header states the **parallel-batch** reservation (E-37 holds v24; this is v25 as assigned up front, the `v18-syllabus.ts:20-23` precedent).
- **`lib/streak/compute.ts`** — the pure run + repair logic (`computeStreak({completedDays, repairs, today}) → {currentRun, repairedDays, repairsUsedThisMonth, newRepairs, lastCompletedDay}`). Two automatic silent repairs per calendar month, charged to the month of the *missed* day; a single missed day inside a run is bridged, two consecutive misses never are, and when credits are gone the run simply ends. Today-not-yet-complete is skipped, not treated as a miss. `currentRun` counts only days actually completed (a repaired day is bridged, never credited — D-19).
- **`lib/streak/store.ts`** — DB glue over `day_ledger` + `streak_repairs`; `INSERT OR IGNORE` on the PK, so recomputation (every read) can never double-spend or rewrite history.
- **`lib/streak/caption.ts` + `components/streak-line.tsx`** — "Day 14" / "Day 14 · repaired Tue" in caption style; a zero run renders `null`/`""`.
- **`lib/knowledge-map.ts` + `components/knowledge-map.tsx`** — the Learn map strip over `CATEGORY_ORDER`, tinting toward `good` only by resolved-slip share. Hand-rolled, no chart library; band 0 is `bg-hairline`.
- **`lib/slips.ts`** — `resolvedSlipCount` refactored onto a new shared read-only `computeSlipStandings(db)`; the map reduces the same standings, so there is exactly **one** notion of mastery.
- **`lib/today-thread.ts` + `components/today-thread.tsx`** — the app's first "evidence on local day D" query, gated to spontaneous, own-speech production positives with E-36's segment verdict and `sessions.exclude_from_evidence` **re-applied at read time**. Null when nothing qualifies.
- **`lib/local-day.ts`** — `previousLocalDay`, `localMonth`, `localWeekday`, `localDayBoundsUtc`, `localHour` (the DST answer lives in `localHour`'s doc comment).
- **`lib/slip-hours.ts`, `components/slip-hours.tsx`, `app/focus/page.tsx`, `lib/focus.ts`** — RETRO-003: bin by the learner's **local** hour, not `getUTCHours()`; user-visible "UTC" strings replaced with "your local time".
- **`lib/today.ts` + `app/practice/page.tsx`** — `TodayView` gains `streak` / `map` / `thread`; the Learn home renders the streak line under the ring, the thread line when true, and the map strip when there is at least one slip.
- **Ritual**: `FEATURES.md` E-38 → `done` (E-39's debt-sweep row loses the UTC-basis line); `STATE.md` regenerated; `docs/schema.md` gains the `streak_repairs` table row + the v25 history row + `Latest version: v25.`
- `.mfactory/work-orders/WO-streak-and-map.md` added in the first real commit.

## Verified

```
npm run typecheck                          # clean
npm run lint                               # No ESLint warnings or errors
npm run test                               # 113 files, 827 tests passed  (762 at E-36 close)
npm run build                              # succeeds (the webpack server realm, not just tsc)
.mfactory/hooks/run-tripwires.sh --all     # TRIPWIRES OK
```

**End-to-end, built server, throwaway DB** (`ERIKA_DB_PATH` under a scratch dir; `data/erika.db` never touched). Seeded a 6-day run with one gap plus one resolved and one stubborn slip, then `npx next start`:

- `GET /api/learn/today` → `streak: {currentRun: 6, repairedDays: [{localDay: "2026-07-21", chargedMonth: "2026-07"}], repairsUsedThisMonth: 1}`.
- `map` → `grammar {slips:1, resolved:0, band:0}` (5 analysed sessions of the same active mistake — heavy activity, **no green**) and `vocabulary {slips:1, resolved:1, band:4}`.
- **Six** requests left **exactly one** `streak_repairs` row; `day_ledger` still 6 rows; `evidence` **0 rows** (this milestone writes none).
- Built `/practice` client bundle contains `data-streak-run`, `data-knowledge-map`, `data-today-thread`, `data-today-map`, `repaired`; built CSS emits `.bg-good`, `bg-good/20`, `/40`, `/65`.

**Per-criterion tests**

| Criterion | Where | What it proves |
|---|---|---|
| 1 streak + repairs | `tests/streak.test.ts` (20) | clean run · unfinished today does not break it · zero run · **one gap repaired** · **second gap same month repaired** · **third gap same month correctly ends the run** · two consecutive misses never bridged (credits not burned) · **month rollover restores credits** · a gap on a month's last day charged to *that* month · **DST**: spring-forward run, fall-back run, a gap that *is* the DST day, half-hour zone `Australia/Lord_Howe` · **idempotent recomputation** (recompute charges nothing; a spent credit stays spent after its day leaves the run; a ledger already showing two spent refuses a third) · store: `INSERT OR IGNORE` no-op, `buildStreak` persists exactly one credit across repeated reads, writes **nothing** to `day_ledger` |
| 2 D-24 render | `tests/streak-render.test.tsx` (8) | markup free of confetti/trophy/badge/streak-freeze/"don't break"/xp/points/level-up/leaderboard/flame/🔥/🎉/"at risk"/countdown/"expires"/"you'll lose"/`text-severe`/`bg-severe`/`text-medium`/`animate-`; no `good` on the streak line; no credit balance ("of 2", "left", "credit"); zero run renders `""`; "Day 14 · repaired Tue" exact |
| 3 map = mastery | `tests/knowledge-map.test.ts` (7) + render | **16 slips / 0 resolved ⇒ `band === 0` and the cell markup contains no `good`**; remission ≠ resolved; strip totals equal `resolvedSlipCount` / `computeSlipStandings`; DB-path case with the mistake recurring in the latest analysed session stays neutral |
| 4 today's thread | `tests/today-thread.test.ts` (13) | positive minted through the **real cascade** + mock audio model. **Four negatives**: bystander-attributed segment (write gate *and* post-hoc re-attribution), excluded session (including flipped *after* minting, then un-flipped), cued/recognition-only, no qualifying evidence. Plus: not on today's plan, different local day, negative polarity, unresolvable provenance → all null. Two `buildToday` cases prove the composer wiring |
| 5 local hours + DST | `tests/slip-hours.test.ts` (9), `tests/slip-hours-render.test.tsx` (3), `tests/day-ledger.test.ts` | every original case converted to local under a pinned `Europe/Rome`; spring-forward skipped hour empty; fall-back repeated hour one bucket of 2; Σ(buckets) conserved on both 2026 transition dates; 23/25-hour `localDayBoundsUtc`; UI no longer says "UTC" |
| 6 gates + migration | `tests/migrations.test.ts` | v25 columns/PK + `INSERT OR IGNORE` no-double-spend; `docs/schema.md` row and `Latest version: v25.` enforced by the existing doc-tracking suite |

### The DST answer (in code at `lib/local-day.ts#localHour`, and in the PR)

`Date#getHours()` maps every instant to exactly one wall-clock hour, so the mapping is total and single-valued across both transitions.
- **Spring forward** — the *skipped* local hour never happened on that date, so its bucket receives nothing from that day. No instant exists to be binned; nothing is lost or misplaced.
- **Fall back** — the *repeated* local hour: both passes report the same wall-clock hour, so that bucket covers two real hours on that one date. Counts stay additive; nothing dropped, nothing double-counted.
- **Σ(buckets) is conserved on every date** (asserted for both 2026 transitions). The residual distortion is one bucket on two dates a year, which is the right trade: the histogram answers "what time was it *for me* when I slipped", and a UTC hour answers a question nobody asked.

## Tests changed/removed

Nothing removed or weakened.

1. **`tests/slip-hours.test.ts`** — four UTC-pinned cases **converted**: identical fixtures, asserted against their local hour under a pinned `Europe/Rome`. `08:00Z → bucket 8` becomes `→ bucket 9`, and one case now asserts `buckets[8] === 0` so the old basis cannot creep back. The midnight-crossing case moves from 23:50**Z** to 23:50 **local** (22:50Z) so it still tests what it claims. The DB-path case moves 14→15 / 15→16. *Why*: the basis changed by design (criterion 5); coverage is preserved case-for-case and extended with three DST cases.
2. **`tests/slip-hours-render.test.tsx`** — fixture timestamps unchanged; asserted bucket indices shift by the pinned offset (9→10, 14→15); one test added asserting the surface no longer says "UTC". *Why*: same basis change; the render assertions themselves are untouched.
3. **`tests/day-ledger.test.ts`** — the existing "local-day basis (D-24 timezone stance)" describe block **extended** with the new seam helpers and the DST assertions. *Why*: extend the seam's own suite rather than start a second local-day suite.
4. **`tests/migrations.test.ts`** — one `it` added for v25. *Why*: new migration.

## Risks

- **The streak read persists.** `GET /api/learn/today` can charge a repair. Idempotent (`local_day` PK), only ever for days strictly in the past, silent to the learner, and it follows the established read-path materialization precedent (slips materialize on read; the composer reconciles spill on read). Documented at the top of `lib/streak/store.ts`.
- **`currentRun` counts completed days, not the run's calendar span.** With one repair a 14-day span reads "Day 13 · repaired Tue". Chosen deliberately as the under-claim (D-19); if the operator prefers the ordinal reading it is a one-line change in `compute.ts` and the caption is unaffected. **Flagging this as the one judgment call a reviewer may want to overturn.**
- **Legacy produced positives (NULL `source_ref`) can never be cited** by the thread — their speaker is unverifiable. Only affects pre-E-36 history; the honest failure direction.
- **Repairs are charged eagerly while walking back**, so opening the app can spend a credit on a weeks-old gap that is still holding a live run together. That is the mechanic working; it is only visible as the run not resetting.
- **D-24's ban list has no tripwire.** `tests/streak-render.test.tsx` is a keyword/class denylist over rendered markup — it catches regressions but is not a substitute for the human read.
- **No browser in the sandbox**, so Playwright could not run. Page wiring is evidenced by the built bundle/CSS markers plus component-level render tests (the repo's existing convention).

## Contracts held

`evidence` append-only and read-only to this milestone (0 rows written, verified on the live route); `lib/findings-model.ts` still the only findings gate; composer/knowledge core untouched; `day_ledger`'s "row only when met" unchanged; **no money path touched** (no biller, ledger row, or model call anywhere in the diff); no shipped migration edited; every file under 500 lines; Conventional Commits; verification only ever against a throwaway `ERIKA_DB_PATH`.

## Blocker

None.
