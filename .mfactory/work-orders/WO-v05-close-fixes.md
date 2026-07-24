# WO-v05-close-fixes — RETRO-003 defect-fix batch (gates the v0.5 close)

Target repo: immaculatecross/erika · Branch: `fix/v05-retro` · **Review tier: Full**
<!-- Full: two of these touch the MONEY PATH (never-waivable spend). A dispatcher-approved
     RETRO-003 defect-fix batch (D-12): defect fixes serving already-ratified invariants. NOT new
     scope. These block declaring v0.5 closed. -->

## First action
Branch `fix/v05-retro` off latest `master`; empty commit + `git push -u origin fix/v05-retro` FIRST. **`git add` this WO file (`.mfactory/work-orders/WO-v05-close-fixes.md`) in your first real commit.**

## Boot
`STATE.md` → `FEATURES.md` → `DECISIONS.md` (**D-14** green=mastery / the-one-number; **D-15** money; **D-18**; **D-20** short-capture norm; **D-24**) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read the money spine (`reserveSpend`/`finalizeReservation`/`releaseReservation`/`sweepStaleReservations` in `lib/analysis/budget.ts`), the sibling lease pattern (`lib/render/engine.ts`, `lib/render/phrase.ts`, ask_notes), `lib/lessons/item-lessons.ts`, `lib/tutor/money.ts` + `lib/tutor/session-config.ts` + `app/api/tutor/session/route.ts` + `app/api/tutor/.../end`, `lib/slips.ts` + `lib/slip-standing.ts`, the focus/letter metric (`lib/focus*`/`lib/findings-model.ts` error-rate), the cost formatter, `lib/settings.ts` + `app/settings/page.tsx`, `vitest.config.ts`.

## The fixes (each with an acceptance test; cite the finding id in the commit)

1. **[T1 — money, never-waivable] `item_lessons` must lease-before-call.** `generateItemLesson` (`lib/lessons/item-lessons.ts:~240-265`) currently reserves+calls, then inserts in a txn — so two concurrent same-item opens both call the model (both really charged) but the loser's PK conflict rolls back its `finalizeReservation`, leaving its real charge unrecorded (swept to $0). Adopt the **sibling lease-before-call pattern**: claim the `item_lessons` row (`INSERT … ON CONFLICT(item_id) DO NOTHING`) BEFORE reserving/calling; the loser sees the claim and returns the cached row with **no** model call. **Test:** two concurrent `generateItemLesson` for the same un-cached item → exactly ONE model call and ONE committed ledger row (mirror the ask_notes concurrent-double test).

2. **[T2 — money, never-waivable] Tutor spend must be server-bounded and recorded on abandonment.** (a) On sweep/abandonment of a `tutor:<id>` lease, **commit the reserved amount** (assume the session ran) instead of releasing to $0 — a crashed/abandoned live session must not vanish from the ledger. (b) Put a **server-chosen max session duration** into the Realtime session config (`buildTutorSessionConfig`) so OpenAI enforces a hard ceiling. (c) `finalizeTutorLease` must **floor elapsed at a server-tracked value** (session open time), not trust client `elapsedSeconds` alone. **Tests:** an abandoned tutor lease that never finalizes commits the reserved amount (not $0) after sweep; the session config carries a max-duration ceiling; finalize uses `max(clientElapsed, serverElapsed)`. Keep the internal cap hard cross-biller. (No new migration — the lease stays on `spend_ledger`.)

3. **[T3 — D-24 mastery] Slip green must require a positive event AFTER the last recurrence.** `positiveEventSlipIds` (`lib/slips.ts:~249-259`) gates green on `cards.last_grade` with no time relation to the slip's last occurrence. Change it to require a positive production/drill event whose timestamp **postdates `lastOccurrenceAt`**, sourced from the **timestamped `evidence` log** (cued/production positive rows), not the `last_grade` snapshot. **Test:** drill-good → slip recurs later → 3 clean sessions ⇒ stays **active** (NOT resolved/green); a positive event after the last occurrence ⇒ resolves. (Preserve the existing after-occurrence-drill-resolves test.)

4. **[P1 — D-14 the-one-number] Gate the error-rate metric.** `/focus` + `/letter` headline "450.0 errors/hour" because the denominator (analyzed-speech time) collapses toward zero for short captures (D-20 norm). Add a **minimum-denominator/confidence floor**: below ≥N minutes of analyzed speech show raw finding **counts** + a quiet "not enough speech yet", never a per-hour rate; drop the false one-decimal precision; keep the rate only above the floor. (Compute in the pure metric fn so a unit test pins it.) **Test:** a corpus with 17 findings over ~2 min shows counts + the floor message, not "450/hr".

5. **[P4 — DESIGN restraint] Sub-cent cost format.** A shared formatter renders a billable estimate only when it rounds to **≥ $0.01**; below that show "est. <1¢" (or nothing where a bare control reads better). Apply everywhere an estimate shows (phrasebook Generate/Ask, item-lesson Start/Generate, reading Listen, shadow Listen). **Test:** $0.002 → "est. <1¢"; $0.02 → "est. $0.02".

6. **[P3a — trust] Hide the inert pronunciation new-item knob.** The "Sounds N/day" Settings knob can never yield an item until E-37 seeds phones. Hide/disable it (with a quiet "arrives with pronunciation studio" note) until then; keep the vocab/grammar knobs. **Test:** the pronunciation knob is not an active control; vocab/grammar knobs persist.

7. **[T6 — gate hygiene] De-flake the rebuild invariant test.** `tests/knowledge.test.ts:~241` times out under full-suite load. Scope the `rebuildAllDerived` assertion to the items under test (not the whole ~31k-row lexicon) OR raise this test's timeout, AND pin a global `testTimeout` in `vitest.config.ts` so the core D-19 invariant can't flaky-red the (soon-required) gates. **Test:** full-suite run is green deterministically.

8. **[polish — DESIGN] Two one-line fixes.** (a) The register segmented control must not wrap to two rows at 402px (`/settings`) — let it scroll or shrink to one row. (b) On the record-first `/`, make **"Record" the primary** (accent/black) action and "Upload audio" secondary — current emphasis is inverted.

## Constraints
- These are FIXES, not a milestone: **do NOT flip FEATURES.md or regenerate STATE** — the dispatcher owns the v0.5-close ritual after this merges. No new migration. No new model/spend path — reuse the one biller. `evidence` append-only; `lib/findings-model.ts` authority. Conventional Commits; hooks; 500-line/file; verify against DISPOSABLE state (throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, NEVER `data/erika.db`); DESIGN.md binding; all gates + tripwires green.
- No `OPENAI_API_KEY` — the tutor/lesson money mechanics are fixture-tested behind the seam (as their milestones were).

## Exit report
Append here per `task.md`: RESULT / PR / Changed / Verified (exact commands + a test per fix, esp. the concurrent-lesson one-call test [T1] and the abandoned-tutor-lease-commits test [T2] and the pre-recurrence-drill-stays-active test [T3]) / Tests / Risks / Blocker.

---

## Exit report

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/54 (branch `fix/v05-retro` → `master`)
Changed:
- [T1] `item_lessons` lease-before-call: `claimItemLesson`/`completeItemLesson`/`releaseItemLesson` (ask_notes pattern); `getItemLesson` returns only completed (`body<>''`) rows; `generateItemLesson` claims BEFORE reserve/call, returns `lesson: ItemLesson|null`; route re-reads (202 in-flight). (`lib/lessons/item-lessons.ts`, `app/api/lessons/item/generate/route.ts`)
- [T2] `sweepStaleReservations` COMMITS an abandoned `tutor:` lease's reserved amount (releases all other stale rows); `buildTutorSessionConfig` carries `maxSessionSeconds`; `finalizeTutorLease` floors billed minutes at server-tracked elapsed (earliest `reserved_at`). (`lib/analysis/budget.ts`, `lib/tutor/money.ts`, `lib/tutor/session-config.ts`, `docs/schema.md`)
- [T3] Slip green reads the timestamped `evidence` log and requires a positive cued/spontaneous event postdating the slip's last occurrence (new `lib/slip-events.ts`; `lib/slips.ts`/`lib/slip-standing.ts`).
- [P1] `computeFocus`/letter `rateReliable` floor (`MIN_RATE_SPEECH_MINUTES=5`); Focus + Letter show counts + "not enough speech yet" below it, no false .0. (`lib/focus.ts`, `lib/letter.ts`, `app/focus/page.tsx`, `app/letter/page.tsx`)
- [P4] Shared `formatEstimate` ("<1¢" below $0.01) at item-lesson/reading/shadow/Ask estimate labels. (`lib/format.ts` + 5 sites)
- [P3a] Pronunciation "Sounds" knob inert until E-37 (`lib/settings-knobs.ts`, `app/settings/page.tsx`).
- [T6] Global vitest `testTimeout: 30_000` + raised rebuild-invariant test (`vitest.config.ts`, `tests/knowledge.test.ts`).
- [polish] Register control no-wrap at 402px; Record primary / Upload secondary on `/` (`app/settings/page.tsx`, `components/recorder.tsx`, `components/empty-state.tsx`, `app/page.tsx`).
Verified: `npm run typecheck` clean · `npm run lint` clean (only the pre-existing workspace-root warning) · `npm run test` 719 passed (100 files, up from 708) · `npm run build` succeeds · `.mfactory/hooks/run-tripwires.sh` exit 0. A test per fix — T1 concurrent-one-call (grammar+vocab), T2 abandoned-lease-commits + max-duration + max(client,server) finalize, T3 pre-recurrence-drill-stays-active fossil, P1 17-findings/2-min floor, P4 $0.002→"<1¢", P3a knob-not-active. Disposable state only (per-test temp DBs / `ERIKA_DATA_DIR`), never `data/erika.db`.
Tests changed/removed:
- `tests/item-lessons-engine.test.ts` — `r1.lesson!.exercises` (return now nullable for the loser); added the T1 concurrent test.
- `tests/item-lessons-schema.test.ts` — `insertItemLesson`→`claimItemLesson`+`completeItemLesson`; second-claim-returns-false replaces second-insert-throws (same PK guard).
- `tests/slips.test.ts` — `drillClean`/inline drill now write cued positive `evidence` via knowledge-linked card grades (the retired `last_grade` path); assertions unchanged; added the fossil test.
- `tests/tutor-money.test.ts` — the stale-tutor-lease-sweep test asserts commit (T2a) instead of release-to-$0.
Risks:
- [T2b] `maxSessionSeconds` is a server ceiling in the config; its exact OpenAI Realtime wire field is pinned at the operator-gated real-run (like `TUTOR_VOICE`) — all paths mock/fixture-tested (no key). Lease + heartbeat + ceiling already bound spend hard server-side.
- [T3] Green now depends on knowledge-linked evidence: a finding-card with no `item_id` won't green its slip on a correct drill until E-28/E-36 attach items — a stricter, more truthful gate (never over-claims green), matching the WO intent; the card-snapshot path is deliberately retired.
- No new migration; no forked money path; cap stays hard cross-biller.
Blocker: none.
