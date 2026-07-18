# WO-honest-home — E-18 The honest home (v0.3 · milestone 3)

Target repo: github.com/immaculatecross/erika · Branch: `feat/honest-home` · **Review tier: Light**
Batch: **parallel with WO-profile-primed (E-19)** — the dispatcher, not the worker, performs the FEATURES/STATE ritual after the batch merges. **Do NOT touch FEATURES.md or STATE.md.**

## Objective

The app's front door tells the truth and prescribes the day. `/practice` becomes a daily plan instead of an interstitial; session rows show what a session yielded; unanalyzed sessions look unanalyzed and can be analyzed inline; Settings shows real month-to-date spend; green means something again. Read-only over existing models — **no model calls, no migration, no new tables.**

## Acceptance criteria (each becomes ≥1 test; no network in tests)

1. `/practice` composes a **daily plan**: due-card count with entry to the drill, the one lesson Focus's severity-weighted ranking prescribes next (reuse `computeFocus` — no reimplemented ranking), and the unread letter if the latest ISO week's letter has not been opened (persist a viewed marker in the existing settings/kv storage — no migration). Empty states per DESIGN.md; no gamification.
2. Sessions list rows show **yield**: speech time, findings count, dominant category for analyzed sessions — all read through `lib/findings-model.ts` (no new gates, no per-session query loops; one aggregate query).
3. **Unanalyzed sessions are visually distinct** and carry an inline Analyze affordance showing the existing cost estimate; sessions whose ingest failed, or with no segments, are gated exactly as the session page already gates (409 semantics respected — no false affordance).
4. Settings shows **month-to-date spend against the monthly cap** from `spend_ledger` (display only — no changes to billing/cap logic).
5. Lesson rows state **"Lesson ready" vs "Generate — est. $X"** using the existing estimate machinery (display only).
6. **Green is reserved** for resolved/mastered/improving: LOW-severity and READY badges lose green per DESIGN.md/D-14; red/green appear only where state carries meaning. Screenshot check light+dark.

## Polish fold-ins on these surfaces (RETRO-001; small, do inline)

- Empty-state disabled-button pattern → real links.
- Auto-named recordings (a mic take gets a sensible default name).
- Mastery shows "Not started" instead of "0%".
- Practice drill queue-cleared recap (a finished queue says so instead of vanishing).
- Replace "cascade" jargon on the analyze affordance with plain words.

## Files and constraints

- Touch: `app/practice/*`, sessions list components, `app/settings/*`, lesson list UI, small lib read helpers. Read findings only via `lib/findings-model.ts`.
- Do NOT touch: `lib/analysis/**` (E-19 owns it this batch), migrations (stay v9), FEATURES.md, STATE.md, the cap/billing logic, SM-2, prompts.
- DESIGN.md binding: ink accent, green/red only with meaning, spring motion, tabular numerals. Files < 500 lines; Conventional Commits; never commit `data/`.

## Out of scope

Slips/fossil states (E-20), contrastive playback (E-21), session map (E-22), pagination, Targets, worker auto-spawn.

## PR + exit report

PR title Conventional-Commit; body: what changed, exact verification commands, risks. Append the `task.md` exit block to this file. Be token-efficient: read only what this WO names plus immediate dependencies; no repo-wide exploration; terse report.

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/28
Changed:  /practice = daily plan (lib/plan.ts, /api/plan; letter-viewed marker in settings kv, no migration)
          sessions list rows carry yield via findings-model aggregates; inline Analyze gated exactly as the route's 409/402
          Settings shows month-to-date spend_ledger spend vs cap (display only)
          lesson rows: "Lesson ready" vs "Generate — est. $X" via the existing estimate machinery
          green reserved (shared SEVERITY_STYLES; READY/LOW/In-deck neutral); RETRO-001 fold-ins (real-link empty states, auto-named takes, "Not started", drill recap, no "cascade" jargon)
Verified: npm run lint / typecheck / test (338 passed, +28) / build; tripwires via pre-commit; live dev-server drive on a throwaway DB (plan, letter-viewed flip, yield, 409/202 analyze, spend, lesson price)
Risks:    /api/sessions shape is a superset (additive); serving /api/letter marks the letter read (prefetch would too); light/dark screenshots not capturable here (proxy blocks chromium download) — reviewer should eyeball
```
