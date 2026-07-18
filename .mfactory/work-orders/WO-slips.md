# WO-slips — E-20 Slips, the fossil dossier (v0.3 · milestone 5)

Target repo: github.com/immaculatecross/erika · Branch: `feat/slips` · **Review tier: Full** (findings semantics + migration)
Batch: **parallel with WO-contrastive (E-21)** — the dispatcher performs the FEATURES/STATE ritual after the batch merges. **Do NOT touch FEATURES.md or STATE.md.** Your migration version is **v11** (E-21 holds v12 — do not renumber).

## Objective

The founding sentence's fourth clause — "stop making them" — becomes real. Findings cluster into persistent **slips** (one recurring mistake = one slip) with a stable key; a slip has a dossier interleaving every occurrence with its drill history on one timeline; a slip's state (active fossil / in remission / resolved) is computed from later analysed sessions; Focus shows a resolved count. Green finally means mastery. **No model calls.**

## Acceptance criteria (each ≥1 test; no network)

1. **Clustering with a stable key.** `lib/slips.ts` (pure core, unit-tested) clusters findings into slips by normalized correction + category, folding in `findings.recurrence_of` links. **Constraint from E-19's review: `recurrence_of` stores the CLIPPED (≤60-char, ellipsis) correction — clustering must not assume string equality with full corrections** (normalize/prefix-match; test with a >60-char correction). The key is deterministic and survives re-analysis (same findings → same key). Migration **v11** (additive): persist slips and the finding→slip association; `docs/schema.md` gains the v11 row — and **fix the v10 row's phrasing to state the clip** (E-19 review advisory).
2. **Slip state.** A pure, unit-tested function computes `active | remission | resolved` from the slip's last occurrence vs later **analysed** sessions (per `lib/findings-model.ts` semantics — no local gates), e.g. resolved after N clean analysed sessions (pick N, state it, make it a named constant). Copy in the UI: "Not heard since 13 Jul · 3 sessions clean" (real dates from data). **Add the fixture variant pinning that a `failed` run's completed segments count as analysed** (open advisory from E-17's delta review — this is its named home).
3. **Dossier.** A slip page interleaves every occurrence (quote, session date, jump-to-audio via the existing `/sessions/[id]?t=` deep link) with its drill history (card grades from SM-2 rows, lesson completions/mastery) on one chronological timeline. Reached from Focus and from a slips index; **no new top-level nav item** — DESIGN.md binding.
4. **Focus integration.** `/focus` shows the resolved count; green attaches ONLY to resolved/remission-improving states (D-14). The "work on next" ranking is unchanged (still `computeFocus`).
5. All reads through `lib/findings-model.ts`; no per-session query loops (SQL aggregates).

## Files and constraints

- New: `lib/slips.ts`, slip pages/components, migration v11. Touched: `lib/focus.ts` (resolved count only), `docs/schema.md`.
- Do NOT touch: `lib/analysis/**` prompts/cascade, the cards/phrasebook UI (E-21 owns those this batch), spend/ledger, SM-2 scheduling logic (read-only), FEATURES.md, STATE.md.
- Migrations append-only; never `data/erika.db`; throwaway DBs only. Files < 500 lines; Conventional Commits.

## Out of scope

Contrastive playback (E-21), session map (E-22), Ask Erika (E-23), Targets, any model call, notifications.

## PR + exit report

Conventional-Commit title; body: what changed, exact verification commands, risks. Append the `task.md` exit block to this file. Token-efficient: read only what this WO names plus immediate dependencies; terse report.
