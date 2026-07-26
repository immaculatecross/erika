# PR #95 — Full-tier delta re-review (post-repair)

- **PR:** https://github.com/immaculatecross/erika/pull/95
- **Prior Full review:** `.mfactory/reviews/PR-95-E48.md` @ `e847fa9`
- **Repair HEAD:** `339de1d` (`fix(tutor): floor Realtime finalize and keep crypto off client`) — confirmed via `gh pr view 95`
- **Worktree read:** `/Users/mattiamauro/Desktop/Murder she wrote/Erika-e48` (fetched; not pushed)
- **Reviewer identity:** author account in this environment — GitHub rejects self-APPROVE / REQUEST_CHANGES. Findings filed as `gh pr review --comment`. **Operator must supply the formal GitHub approve / request-changes.**
- **CI at review time:** `gates` run `30207935030` **IN_PROGRESS** (lint + typecheck completed success; Test in progress; Build pending). Local `npm run build` on `339de1d` **succeeded** (tutor page compiled; no `node:crypto` UnhandledSchemeError).
- **Recommendation:** **APPROVE**
- **Counts:** **0 BLOCKING**, **0 new ADVISORY** (ratchet: A2/A4 left standing, not re-litigated)

## Scope

Confirm only whether prior **B1** and **B2** are closed, and whether the repair introduced new equal-or-greater harm. A1/A3 were in-scope if present; A2/A4 were not required this cycle.

## Repair read

Diff `e847fa9..339de1d` (10 files): `lib/tutor/money.ts`, `app/api/tutor/session/[id]/end/route.ts` comment, `lib/tutor/prompt-presets.ts` + new `prompt-presets-server.ts`, `CATEGORY_MAPPING_INSTRUCTION` moved to `lib/analysis/categories.ts`, `session-config` / contract tests import hash from server module, `stt-rates` doctrine comment, three new `tests/tutor-money.test.ts` cases.

## B1 — CLOSED

**Prior harm:** native `/end` passed finite client `realtimeUsageCostUsd` (including `0`) into `finalizeTutorLease`, which committed `min(usage, reserved)` and skipped the [T2c] minute floor → $0 Realtime row → monthly cap fail-open.

**Repair:** `lib/tutor/money.ts:265-272` now computes `minuteFloor = estimateTutorSessionUsd(model, billedMinutes)`, then `actual = clientUsage === null ? minuteFloor : Math.max(minuteFloor, clientUsage)`, then `committed = Math.min(actual, reserved)`. Module comment matches.

**Tried to re-break:**

| Input | Outcome |
|---|---|
| Client usage `0`, server ~10 min lease | Commits ~10-min floor (test + code path) |
| Understated finite positive (`0.001` vs multi-minute floor) | `max(floor, usage)` → floor |
| Negative usage | `Math.max(0, usage)` → `0` → floor |
| Missing / `NaN` | `clientUsage === null` → floor |
| Huge client usage vs reserved | Still `min(..., reserved)` |

Native client still always sends finite `nativeSessionUsageUsd.current` (often `0`) on stop/pagehide (`use-tutor-lab.ts`); that value can no longer wipe the floor. End route still forwards finite numbers including `0` (`end/route.ts:54`) — correct now that finalize floors.

**Tests:** `tests/tutor-money.test.ts` — “never commits $0…”, “bills max(minuteFloor, clientUsage)…”, “falls back… missing or NaN”. The $0 case would fail on the pre-repair finalize; sensitive. `npx vitest run tests/tutor-money.test.ts` — 20/20 passed.

Prior **A1** (no usage-path test) is addressed by those cases.

## B2 — CLOSED

**Prior harm:** `prompt-presets.ts` imported `node:crypto`; `realtime-client` → `use-tutor-lab` → tutor page pulled it into the client bundle → CI build failed.

**Repair:** `tutorPromptHash` lives in `lib/tutor/prompt-presets-server.ts`; client-safe `prompt-presets.ts` imports `CATEGORY_MAPPING_INSTRUCTION` from `categories.ts` (no Node). Server `session-config` imports hash from the server module.

**Tried to re-break:** value-import graph from tutor page / `use-tutor-lab` / `realtime-client` / `prompt-presets` — **no** `node:crypto` / `prompt-presets-server` / findings / money / db. Local `npm run build` compiled successfully; `/practice/tutor` in the route table.

## A3 — addressed (not required to block)

`lib/analysis/stt-rates.ts` doctrine now names E-48 transcript `/api/tutor/turn` billing; no longer claims drill-only reachability.

## New BLOCKING from repair?

None. Ratchet: no pre-existing already-reviewed advisory re-raised as BLOCKING. A2 (concurrent transcript 402 vs 409) and A4 (End disabled mid-turn) remain out of this cycle’s required scope and are unchanged by the repair.

## Tried hardest to break

Client `realtimeUsageCostUsd: 0` / understated / negative / missing / NaN / overstated-vs-reserved against the new finalize formula; remaining Node imports on the tutor client import graph; local production build of the Conversation page.

## Formal GitHub state

Posted as `gh pr review 95 --comment`. **Operator must APPROVE** (recommended) or REQUEST_CHANGES if pricing a finding this review did not raise.
