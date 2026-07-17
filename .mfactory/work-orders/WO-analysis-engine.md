# WO-analysis-engine — E-4 Analysis (part 1 of 2): the cascade engine, findings & money-safety

Target repo: github.com/immaculatecross/erika · Branch: `feat/analysis-engine` · Diff cap: ~400 lines soft (excl. lockfile & fixtures). If it can't fit, report `split` at the fault line **[OpenAI client + cascade + findings persistence + smoke]** then **[rates + cost estimator + budget cap + spend ledger]**.

**Milestone context.** Part 1 of 2 of E-4 (Analysis). This part is the **backend engine**: the two-stage audio-model cascade that turns E-3's speech segments into persisted findings, with the cost estimate, spend ledger, and budget cap that make it safe to run. **Part 2 (WO-analysis-report) is the report UI** (per-category counts, expandable findings, jump-to-audio, pre-run cost estimate display). This is the first milestone that **spends real money** — the money-safety criteria below are as important as the cascade itself.

## Pinned technical decisions (do not substitute without reporting `blocked`)

- **The cascade (D-10):** for each speech segment, **`gpt-audio-mini`** triages the *time-compressed triage rendition* (E-3 already produced and cached these per segment) and flags whether the window is suspicious; only for flagged windows does **`gpt-audio-1.5`** (fallback `gpt-audio`, per D-3) deep-listen the *original native-speed* segment audio and return findings. Never send an unflagged window to the deep model. Never send silence (E-3 already stripped it).
- **Audio-model API:** call OpenAI with **audio input** (base64 `input_audio` content parts) requesting **structured JSON** output; models `gpt-audio-mini` and `gpt-audio-1.5`. Isolate ALL of this behind one thin client module (e.g. `lib/analysis/audio-model.ts`) with a typed interface, so the cascade/parsing/cost logic is unit-tested against a **mocked** client — no test makes a real call. Read `OPENAI_API_KEY` from the environment (present in `.env.local`); never log or commit it.
- **Findings cache by content hash (never re-bill — D-10):** findings are keyed by the segment's `content_hash` (from E-3). Before any model call for a segment, check the cache; a hit yields the stored findings and makes **zero** API calls. Identical audio (same hash, even across sessions) is analyzed once, ever.
- **Async, job-based:** analysis runs as an async job (extend the worker / job model from E-3 — a new `analysis_jobs` row per run, or an equivalent), with visible `state`/`stage`/`progress` like ingest. Do not block a request on the cascade.
- **Rates table (editable — D-10):** a single `lib/analysis/rates.ts` with per-model unit rates (e.g. $/audio-minute or $/token — pick what the API bills on and document it). This is the one place prices live.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. Cascade, parsing, cost, and budget logic are tested against a **mocked** audio-model client + synthesized fixtures. Exactly ONE real-API smoke run (below) proves the live wiring.

1. **Cascade shape.** Given segments, the engine calls `gpt-audio-mini` on each segment's triage rendition, and `gpt-audio-1.5` **only** on the segments mini flagged. (Test with a mock client: assert mini called for all, deep called only for flagged; an all-clear segment triggers no deep call.)
2. **Findings parsed & persisted.** A model JSON response parses into findings rows (migration v4 `findings`: session FK cascade, `content_hash`, `quote`, `correction`, `category ∈ {grammar,vocabulary,phrasing,idiom,pronunciation}`, `explanation`, `severity ∈ {high,medium,low}`, `start_ms`, `end_ms`, `created_at`). Malformed/partial model output is rejected with a truthful error and does not persist garbage or crash the job. (Test: a good fixture response → correct rows; a malformed one → truthful handling, no partial write.)
3. **Dominant-speaker focus.** The deep-model prompt instructs it to focus on the dominant/primary speaker and ignore bystanders (full voice enrollment is E-13 — note it). (Test: assert the prompt carries the instruction; this is prompt-level for v1.)
4. **Never re-bill cached segments.** Re-running analysis on a session, or analyzing a duplicate segment (same `content_hash`), makes **zero** new model calls for the cached segments and reuses stored findings. (Test with a spy client: second run over the same hashes → call count 0; cost ledger unchanged.)
5. **Cost estimate.** A pure estimator computes a pre-run cost from the rates table over the *not-yet-cached* segments (mini over all pending renditions + expected deep over an assumed/però-configurable flag rate), returned before a run starts. (Test: given fixture segment durations + rates, the estimate matches the hand-computed figure; cached segments are excluded.)
6. **Budget cap halts truthfully.** Settings `monthlyBudgetUsd` is a hard cap. Before each billable call the engine checks month-to-date spend (from the ledger) + the call's cost against the cap; if it would exceed, the run **halts with a truthful state/message** (e.g. job state `halted`/`failed` with "monthly budget reached") — it never silently proceeds, never bills over the cap, and persists whatever findings it already produced. (Test: set a tiny budget, seed near-cap spend, run → halts before the over-budget call; ledger never exceeds the cap.)
7. **Spend ledger.** Every real billable call records its actual cost with a month key in a `spend_ledger` table (migration v4); cached calls record nothing. Month-to-date spend is a queryable total. (Test: N billable calls → N ledger rows summing correctly; a cached call → no row.)
8. **One real-API smoke, documented.** Make exactly ONE minimal real call to `gpt-audio-mini` and ONE to `gpt-audio-1.5` on a single short segment, to prove the live wiring and the response parses; record the outcome (and rough cost) in the PR description. **If the model or endpoint is unavailable, do NOT retry-thrash — stop and report `blocked` with the exact API error** (this is a legitimate blocker for the dispatcher/operator). Do not run the cascade over large audio during development — keep real spend to a few cents.

## Files and constraints

- **Migration v4** (append-only; never edit v1–v3): `findings`, `analysis_jobs` (or equivalent), `spend_ledger`. FK cascade on session delete; extend the session-delete cleanup to remove findings/analysis rows (shared, hash-keyed caches follow E-3's retain policy — note it).
- **New modules** (each < 500 lines, single-purpose), suggested under `lib/analysis/`: `audio-model.ts` (the isolated OpenAI client + typed interface), `cascade.ts` (orchestration), `findings.ts` (parse + typed data layer, `lib/settings.ts` style), `rates.ts`, `cost.ts` (estimator), `budget.ts` (ledger + cap check). Reuse E-3's segments/renditions and the worker/job pattern; reuse `lib/audio-storage.ts` paths.
- **API routes** (Node runtime): a GET cost-estimate endpoint and a POST start-analysis endpoint for a session; the POST **re-checks the budget server-side** (never trust a client-sent estimate). No findings mutation endpoints beyond starting a run.
- **Secrets:** `OPENAI_API_KEY` from env only; never printed, never committed (the tripwire will catch a committed key — don't rely on it, just don't).
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; the `gates` CI check must stay green **without any network/API access** (all CI-run tests use the mocked client — the real smoke is local only, documented in the PR).

## Out of scope (do not touch)

- **The E-4b report UI**: per-category counts, expandable findings, jump-to-audio, the pre-run cost-estimate confirmation UI, live analysis progress display. A minimal way to trigger a run for your own verification is fine, but the report surface is part 2.
- Flashcards from findings (E-5); micro-lessons (E-6); voice enrollment/diarization (E-13 — dominant-speaker is prompt-level here).
- The E-2/E-3 capture & ingest pipelines and their contracts (reuse read-only); editing shipped migrations.

## Milestone ritual (this PR)

E-4 completes in part 2, so set **FEATURES.md E-4 `next → building`** (not `done`; don't touch E-5). Leave STATE.md accurate; a one-line "E-4 in progress: analysis engine landed" note is fine if truthful. Full regen belongs to part 2.

## PR description must state

What changed per area; the **exact commands** proving each criterion (cascade shape, never-re-bill call counts, budget-halt, parsing); the **documented real-API smoke** result and its rough cost; and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report (worker)

```
RESULT: done
PR:       <filled on push>
Changed:  migration v4 (findings, analysis_jobs, segment_analyses, spend_ledger);
          lib/analysis/{rates,cost,budget,findings,audio-model,cascade}.ts;
          GET …/analysis/estimate + POST …/analysis routes; worker drains analysis
          jobs; session-delete comment; FEATURES E-4 next→building; STATE note.
Verified: npm run test|lint|typecheck|build all green (99 tests, no network).
          Cascade shape, no-partial-write, never-re-bill, budget-halt, parsing,
          ledger, estimate all covered by mocked-client tests. ONE real gpt-audio-
          mini + ONE real gpt-audio-1.5 smoke on a planted-error clip parsed
          correctly (~$0.004 rough, ~365 tokens deep); total real spend a few cents.
Risks:    per-minute rates are a documented approximation of OpenAI token billing;
          audio models occasionally return unparseable prose (fails truthfully,
          no partial write); no report UI (E-4b).
Blocker:  none.
```
