# WO-contrastive — E-21 Contrastive playback (v0.3 · milestone 6)

Target repo: github.com/immaculatecross/erika · Branch: `feat/contrastive` · **Review tier: Full** (billable path + migration)
Batch: **parallel with WO-slips (E-20)** — the dispatcher performs the FEATURES/STATE ritual after the batch merges. **Do NOT touch FEATURES.md or STATE.md.** Your migration version is **v12** (E-20 holds v11 — do not renumber; if your branch's migration runner sees only v10 at build time, still number yours v12 and note it).

## Objective

Hear the correction, not just read it. Each finding's correction can be rendered once in the audio model's voice; a **Compare** control on card backs and phrasebook rows plays your clip then the native rendering. Rendered once, cached forever, ledgered exactly once; the budget cap refuses generation truthfully.

## Acceptance criteria (each ≥1 test; no network — model clients mocked per D-13)

1. **Render-once engine.** `lib/render/` produces the correction audio via the existing audio-model client seam (TTS request), stores the file under `data/renditions/` keyed by finding, and records **exactly one `spend_ledger` row per finding** using the existing rates/estimate machinery. Replays make **zero** model calls and add zero ledger rows (test: render, replay N times → 1 call, 1 row). Concurrent double-click cannot double-bill (reuse the existing job/lease or an INSERT-first guard — state which).
2. **Budget cap.** Generation is refused truthfully when the monthly cap is reached (same 402 semantics/copy pattern as analysis); the refusal makes no model call and writes no ledger row.
3. **Compare control** on card backs and phrasebook rows: plays the user's own clip (existing segment audio at the finding's timestamp) then the rendition; states clearly when a rendition doesn't exist yet ("Generate — est. $X" using the rates table) vs exists (plays immediately). DESIGN.md binding; no green unless the state carries meaning.
4. **Migration v12** (additive): rendition record (finding id, path, created, cost). `docs/schema.md` v12 row (doc-binding test).
5. **Deletion coherence:** deleting a session/finding removes or orphans-safely its rendition file (no crash on missing file; no dangling playback).

## Files and constraints

- New: `lib/render/*`, rendition API route, Compare component; touched: card-back component, phrasebook row component, `docs/schema.md`, migration v12.
- Do NOT touch: `lib/analysis/**` cascade/prompts, `lib/slips*`/Focus (E-20 owns those this batch), SM-2, VAD/ingest, FEATURES.md, STATE.md.
- D-13 note for the PR: coverage is fixture-based (no API key in this environment); the client seam is the same one analysis mocks. Never `data/erika.db`; throwaway paths. Files < 500 lines; Conventional Commits.

## Out of scope

Minimal-pair drills / pronunciation studio (E-8, v0.4), session map (E-22), Ask Erika (E-23), batch pre-rendering (render only on user action), voice choice settings.

## PR + exit report

Conventional-Commit title; body: what changed, exact verification commands, risks. Append the `task.md` exit block to this file. Token-efficient: read only what this WO names plus immediate dependencies; terse report.
