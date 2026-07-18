# WO-ask-erika — E-23 Ask Erika (v0.3 · milestone 8, the finale)

Target repo: github.com/immaculatecross/erika · Branch: `feat/ask-erika` · **Review tier: Full** (model call + spend ledger + migration).
Batch: **solo** (serial; follows E-22 on the merged master). Migration version: **v13** (v12 is the latest on master at dispatch).

## Objective

Any finding gains an **"ask for more"** affordance: Erika returns a persisted deeper note that **cites at least one other finding from the user's own corpus**. Re-opening a note makes **zero** model calls (cached, exactly one ledger row per note); generation is **budget-capped and ledgered** truthfully. This closes v0.3.

## Acceptance criteria (each ≥1 test; no network — the model client is mocked exactly as analysis/render mock theirs, D-13)

1. **Ask engine.** A new `lib/ask/` builds the prompt from the finding plus a compact set of the user's *other* findings (reuse `lib/findings-model.ts` and, where useful, `lib/analysis/profile.ts` — do not reimplement corpus selection math), calls the text model once, and persists the note. The persisted note **must reference ≥1 other finding by id** (the citation is structural, not just prose) — a test asserts the stored note carries at least one valid corpus citation, and that the citation resolves to a real included finding.
2. **Render-once / zero re-bill.** Re-opening a finding's note makes **zero model calls** and adds **zero** ledger rows (test: ask once → 1 text call + exactly 1 `spend_ledger` row; re-open N times → 0 calls, 0 rows). Concurrent double-ask on the same finding cannot double-bill — **use lease-before-spend (claim the note row BEFORE the budget check and the model call), mirroring E-21's renditions**; a loser makes zero call and zero row; a budget refusal / failed call releases the claim for a clean retry. State this explicitly and test the concurrent case with a `client.calls===1` assertion.
3. **Budget cap.** At/over the monthly cap, ask is refused truthfully (same 402 semantics/copy as analysis and render), zero model call, zero ledger row.
4. **Migration v13** (additive): persist notes keyed by finding (PK on finding_id doubles as the render-once cache key + lease, per E-21's proven pattern), storing the note text, its cited finding id(s), cost, created_at. `docs/schema.md` gains the v13 row (doc-binding test). Deleting a finding/session cascades the note away; playback/display is orphan-safe.
5. **UI.** The ask affordance appears on a finding (report and/or card back — pick the surface the WO-author judges primary and say which; DESIGN-binding, no green unless state carries meaning); shows "Ask — est. $X" (rates table) when no note exists vs the note immediately when it does; the cited finding(s) are linked/jump-navigable.

## Files and constraints

- New: `lib/ask/*`, an ask API route, migration v13, an ask component; touched: the chosen finding-display component, `docs/schema.md`, `lib/analysis/rates.ts` (a text-ask rate knob only, like E-6/E-21 — NOT the cascade/prompts).
- Do NOT touch: `lib/analysis/**` cascade/prompt behaviour, VAD/ingest, SM-2, the render/rendition engine (E-21) beyond reading its lease pattern as a model, `lib/slips*`, FEATURES.md, STATE.md.
- Never-waivable (D-15): unrecorded/unbounded spend. The lease-before-spend ordering from E-21 is the required shape — a concurrent ask must make at most one billable call. Migrations append-only, "shipped means applied anywhere" — v13 is new, never an amend. Files < 500 lines; Conventional Commits; never `data/erika.db`; throwaway DBs only.

## Out of scope

Targets, pagination, minimal-pair/pronunciation (E-8), realtime (E-10) — all v0.4. No batch pre-generation (ask only on user action). No new nav item.

## PR + exit report

Conventional-Commit title; body: what changed (state the lease-before-spend ordering explicitly and how the citation is enforced), exact verification commands, the D-13 fixture-only note (no API key in this env), and risks. Append the `task.md` exit block. Token-efficient: read CLAUDE.md, DESIGN.md, `lib/render/engine.ts` (as the lease template), and only the files this WO names; no repo-wide sweep; terse report. Commit incrementally.
