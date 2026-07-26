# RUN-009 — Tutor model and prompt lab

Date: 2026-07-26 · Mode: direct · Dispatcher: GPT-5.6 Sol · Target: github.com/immaculatecross/erika

## Preflight

- [x] Canonical mfactory checkout known at `/Users/mattiamauro/Desktop/Murder she wrote/mfactory-v2`; pinned kit and factory are frozen during RUN-008/RUN-009. The local canonical checkout is 50 commits behind its remote, so no mid-mission resync is attempted.
- [x] Fresh Cursor worker sessions are available; width is capped at two total agents.
- [x] Author identity authenticated: `gh auth status` = `immaculatecross`.
- [x] Review path ready: master requires zero approvals; one fresh Full reviewer verdict is mandatory because this mission touches external API, secrets and billing.
- [x] Remote and protection verified: `origin` = `immaculatecross/erika`, PRs and linear history enforced, required check `gates`, force-push/deletion disabled.
- [x] Default branch baseline at dispatch was behind E47; E48 started from `origin/master`, owned no migration, and rebased after #94/#96.
- [x] Work order written: `.mfactory/work-orders/WO-E48-tutor-model-prompt-lab.md`.
- [x] Run shape checked: pipeline behind E47 review by explicit operator direction; merge remained serialized.
- [x] Live spend authorized up to $1.50 against a disposable database; key never printed or committed. Spike 8 recorded **$0.636831** under that ceiling.

## Mission

Replace automatic VAD turns with a manual Speak/Done boundary and give the operator an in-UI A/B lab for Realtime 2.1 native listening versus OpenAI STT → GPT-5.6 Terra, across five named prompt presets. Work order: `.mfactory/work-orders/WO-E48-tutor-model-prompt-lab.md`.

## Scope and run shape

One user-recognizable research milestone, one work order, one PR. Pipelined while E47 was in Full review by operator authorization. No migration; no E47 lesson-preparation file overlap. Review tier **Full**.

## Timeline of facts

- 2026-07-26 — operator scoped Speak/Done, five presets, Native vs Transcript; authorized start while E47 was in review.
- 2026-07-26 — WO-E48 / RUN-009 opened; worker built PR #95.
- 2026-07-26 — E47 #94 merged (`fcbb86a`); ritual #96 closed FEATURES/STATE for E-47.
- 2026-07-26 — E48 rebased onto E47 then onto ritual master; Native `({…})` unwrap landed.
- 2026-07-26 — Full review REQUEST CHANGES: B1 client `$0` Realtime finalize (cap fail-open); B2 `node:crypto` in client bundle (CI build red).
- 2026-07-26 — One repair (`339de1d`): floor finalize at `max(minuteFloor, clientUsage)`; split `prompt-presets-server`; tests for `$0` path.
- 2026-07-26 — Delta re-review APPROVE; operator approved; CI green; #95 squash-merged as `413d59a`.

## What broke or fought back

- Native strict JSON initially failed 25/25 matrix cells; post-rebase probe showed valid objects wrapped as `({…})` — unwrap, not redesign.
- First CI after ritual rebase failed: `prompt-presets` pulled `node:crypto` into the tutor page client graph.
- Native `/end` trusted client `realtimeUsageCostUsd` including `0`, skipping the [T2c] minute floor — monthly-cap fail-open; required repair (never waive unrecorded spend).
- Concurrent `gh pr merge` from a detached checkout / second worktree raced on local branch delete after remote merge already succeeded.

## Component scorecard (worked | fought | broke)

| Component | Verdict | One-line note |
|---|---|---|
| Work order | worked | Architectures, presets, manual turns, spend and measurement were observable. |
| `task.md` worker | worked | PR #95 shipped; rebase + B1/B2 repair closed. |
| `review.md` reviewer | worked | Full REQUEST CHANGES → delta APPROVE; author account comment-only (D-08). |
| Dispatch loop | worked | Pipelined behind E47 by operator direction; ritual after merge. |
| Hooks & gates | fought | Build red once (crypto); green after repair. |
| Artifacts | worked | WO, spike 8, reviews, this run report. |

## Signals

| Signal | Value |
|---|---|
| Sessions: workers / reviews / other | ~4 workers (build, rebase×2, repair) / 2 reviews (Full + delta) / ritual |
| Outcomes: first-pass approvals / repairs / escalations | 0 first-pass / 1 repair cycle / 0 escalations |
| Routing misses · hook blocks · interruptions | 0 · 0 · 0 |
| Cold-start walkthrough | n/a — research milestone; spike 8 + browser lab instead |
| Wall clock per role | same calendar day |
| Tokens per role | n/a |
| Live API spend (spike 8) | ≈ $0.64 / $1.50 ceiling |

Pass ledger: `WO-E48-tutor-model-prompt-lab: pass` (after one Full repair cycle).

## Lessons

- L: An experiment comparing listening models must hold the speaking model constant, or output quality and latency confound the result. → encoded as: WO-E48 criteria 3–5 and 8.
- L: Detection completeness and spoken correction count are separate product questions. → encoded as: shared `errors[]` versus `reply` contract in WO-E48 criterion 5.
- L: Client-supplied usage that can be finite `0` bypasses a server minute floor is monthly-cap fail-open. → encoded as: `finalizeTutorLease` `max(minuteFloor, clientUsage)` + tutor-money tests.
- L: A Node crypto helper sharing a module with client-imported constants breaks Next client builds. → encoded as: `prompt-presets-server.ts` split.
- L: Realtime may wrap valid JSON as `({…})`; unwrap the measured quirk without loosening schema. → encoded as: `unwrapTutorTurnPayload` + spike 8 amendment.

## Verdict

**Done.** PR #95 merged (`413d59a`). Dispatcher FEATURES/STATE ritual closes E-48.
