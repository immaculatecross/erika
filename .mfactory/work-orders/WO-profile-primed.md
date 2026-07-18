# WO-profile-primed — E-19 Profile-primed analysis (v0.3 · milestone 4)

Target repo: github.com/immaculatecross/erika · Branch: `feat/profile-primed` · **Review tier: Full** (analysis correctness path + migration)
Batch: **parallel with WO-honest-home (E-18)** — the dispatcher, not the worker, performs the FEATURES/STATE ritual after the batch merges. **Do NOT touch FEATURES.md or STATE.md.** This batch's single migration belongs to THIS work order: **v10**.

## Objective

The model doing the listening finally knows who it's listening to. A compact speaker profile — native language, top recurring quote→correction pairs, per-category rates, mastery — is built from existing data **without any model call** and injected into the triage, deep-listen, and lesson prompts. The deep model may mark a finding as recurring a profile entry; that link is persisted. "It studies you" becomes true of the analysis, not just the display layer.

## Acceptance criteria (each becomes ≥1 test; no network — model clients mocked/fixtures)

1. **Profile builder** `lib/analysis/profile.ts` (pure, unit-tested): native language from Settings, top-N recurring quote→correction pairs (dedup by correction, severity-weighted), per-category rates via `computeFocus`/`lib/findings-model.ts` (no reimplemented math), lesson mastery. Bounded size (hard cap on entries/characters — prompts must not grow with corpus size unbounded). Empty profile (fresh user) yields a well-formed minimal profile.
2. **Prompt injection**: triage, deep-listen, and lesson-generation prompts each carry the L1 line and the profile lines. Fixture tests assert the exact L1 and profile content appears in the built prompt for all three. A fresh user's prompts remain valid (no "undefined", no empty scaffolding).
3. **Recurrence marking**: the deep-listen reply schema gains an optional recurrence reference to a profile entry; when present it is persisted (migration **v10** — additive only). **D-13 defensive handling**: the field is optional everywhere — a reply without it, or with an unknown reference, parses exactly as today and never fails a segment or the run. Fixture tests: reply with valid recurrence (persisted), without (fine), with garbage reference (ignored, finding still persisted).
4. **No spend behavior changes**: cached segments are never re-billed (profile injection must not change the segment content-hash/caching identity); the estimate/ledger/cap logic is untouched by tests proving the same calls/rows as before on a fixture run.
5. `docs/schema.md` gains the v10 row (the migrations doc-binding test enforces it).

## Files and constraints

- Touch: `lib/analysis/profile.ts` (new), prompt-building in `lib/analysis/*`, deep-reply parser (optional field), `lib/migrations/index.ts` (v10 additive), `docs/schema.md`.
- **No UI changes** — recurrence display belongs to E-20; exposing the persisted link through an existing API response field is fine, rendering it is not this milestone.
- Do NOT touch: `app/practice`, sessions list, Settings UI (E-18 owns those this batch), the cap/billing/ledger logic, VAD, SM-2, FEATURES.md, STATE.md.
- Migrations append-only; "shipped means applied anywhere" — v10 is a new migration, never an amend. Files < 500 lines; Conventional Commits; never commit `data/`; verification only against throwaway DB paths, never `data/erika.db`.

## Out of scope

Slips clustering/dossiers/states (E-20), any real-API smoke (no key in this environment — fixture coverage per D-13, and say so in the PR), prompt-tuning beyond adding the profile block.

## PR + exit report

PR title Conventional-Commit; body: what changed, exact verification commands, risks. Append the `task.md` exit block to this file. Be token-efficient: read only what this WO names plus immediate dependencies; no repo-wide exploration; terse report.

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/27
Changed:  lib/analysis/profile.ts (new) — bounded speaker profile, zero model calls, rates via computeFocus
          triage/deep/lesson prompts carry L1 + profile block (cascade builds profile once per run)
          deep reply: optional recurrenceId → findings.recurrence_of (migration v10, additive; D-13 defensive)
          docs/schema.md v10 row; 23 new fixture tests (profile, recurrence, migration)
Verified: npm run lint · typecheck · test (334 passed) · build · .mfactory/hooks/run-tripwires.sh — all green;
          fixture tests prove identical calls/ledger rows with and after profile growth (no re-billing)
Risks:    fixture-only coverage per D-13 (no real-API smoke — no key in this environment); recurrence link
          stores the cited entry's clipped correction text; prompts grow by a hard-capped ≤1200 chars
```
