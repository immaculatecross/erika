# RUN-008 — Italian lessons prepared ahead

Date: 2026-07-26 · Mode: direct · Dispatcher: GPT-5.6 Sol · Target: github.com/immaculatecross/erika

## Preflight

- [x] Canonical mfactory checkout known; mfactory frozen for the run.
- [x] Author identity authenticated: `immaculatecross`.
- [x] Review path ready: master requires zero approvals; fresh Full reviewer verdicts posted as comments under D-08.
- [x] Remote and protection verified: PRs, linear history, required check `gates`.
- [x] Work order: `.mfactory/work-orders/WO-E47-italian-lessons-ahead.md`.

## Mission

Operator chose Italian teaching content plus one-lesson-ahead preparation before session launch. Scoped as E-47, first operator-directed v0.8 milestone. PR: https://github.com/immaculatecross/erika/pull/94 · merged as `fcbb86a`.

## Timeline of facts

- 2026-07-26 — WO-E47 and RUN-008 opened; worker delivered PR #94 (`94d90ac`); CI green.
- Two independent Full reviews REQUEST CHANGES (language gate, vocabulary planner, double-bill race, authored defects, onboarding Start wall).
- Repair cycle 1 (`905dad2`) + exceptional cycle 2 (`bf4eb22`) closed standing blockers; final delta found a new active-claim lesson-swap race.
- Operator chose surgical option: freeze/pin served lesson at Start.
- Pin fix `a9e840a` APPROVED (`.mfactory/reviews/PR-94-pin.md`); CI green; PR #94 squash-merged.
- Dispatcher ritual: FEATURES E-47 → done; STATE regenerated for v0.8 / v31.

## What broke or fought back

- Concurrent build/typecheck races on `.next/types` (tooling false red).
- Author-account `gh` cannot native REQUEST CHANGES / APPROVE; reviews posted as comments with explicit verdict (D-08).
- One repair was not enough; an exceptional second repair introduced the active-claim swap, closed by the operator-authorized pin.

## Component scorecard

| Component | Verdict | One-line note |
|---|---|---|
| Work order | worked | Product/money/cache boundaries explicit. |
| `task.md` worker | worked | Delivered, repaired, pinned; durable exits. |
| `review.md` reviewer | worked | Found real walls and unreal tests; pin delta APPROVE. |
| Dispatch loop | fought | Past one-repair rule; operator priced the last race. |
| Hooks & gates | fought | `.next` race; otherwise green. |
| Artifacts | worked | WO, reviews, run report durable. |

## Signals

| Signal | Value |
|---|---|
| Sessions: workers / reviews / other | 1+repairs / 4 Full deltas / 0 |
| Outcomes: first-pass approvals / repairs / escalations | 0 / multi / 1 (operator pin choice) |
| Routing misses · hook blocks · interruptions | 0 · 0 · 0 |
| Cold-start walkthrough | n/a for this milestone; built onboarding→Start walks required and passed on pin |
| Wall clock per role | ~3 h end to end |
| Tokens per role | n/a |

Pass ledger: `WO-E47-italian-lessons-ahead: repaired then merged`.

## Lessons

- L: A readiness gate keyed on claim state rather than servability creates an onboarding wall. → encoded as: Start pins/serves authored Italian when no complete body exists.
- L: After Start, an active claim must not be able to replace the taught body. → encoded as: `pinServableItemLesson` + `completeItemLesson` ownership/`body = ''` guards.
- L: Changed tests must be mutation-sensitive for the repaired predicate, not merely green. → encoded as: aggregate language and claim-token ordering tests.

## Verdict

Merged. E-47 done. Would dispatch the next mission on today's mfactory unchanged for this product loop.
