# WO-hardening-core — E-16 Hardening & integrity (part 1 of 2): the four confirmed defects

Target repo: github.com/immaculatecross/erika · Branch: `feat/hardening-core` · Diff cap: ~400 lines (excl. lockfile & fixtures)

**Milestone context.** First milestone of **v0.3** (D-16, ratified from RETRO-001). This part fixes the **four confirmed integrity defects** a three-lens retro found — each one invisible to the ~20 per-PR reviews that preceded it, because each lives *between* milestones rather than inside any single diff. **Part 2 (WO-hardening-sweep) is the debt sweep** (mic silent-drop, 404-polling, cache eviction, the NUL hook copy, polish fold-ins) — do not do those here. Integrity goes first in v0.3 because the features that follow (slips, contrastive playback, the session map) all build on correct timestamps and correct billing.

**These are not speculative.** Each defect below was reproduced by the technical lens. Your job is the fix plus a regression test that fails against today's code — verify that failure explicitly (e.g. stash the fix, watch the test fail, restore), and say so in your exit report.

## What exists (reuse, do not redesign)

- `lib/analysis/findings.ts` — `persistSegmentFindings` (spend+findings+witness in ONE transaction — preserve that), `reuseCachedFindings`, `getSegmentAnalysis`, `isSegmentComplete`.
- `lib/analysis/cascade.ts` — `runAnalysisJob`, `claimNextAnalysisJob`, `reclaimStuckAnalysisJobs`, `pendingSegments`; segment absolute timestamps computed as `seg.startMs + rel`.
- `lib/ingest/pipeline.ts` — `processJob`, `claimNextJob`, `reclaimStuckJobs`, stage checkpoints. `lib/ingest/vad.ts` — `speechIntervals` (merges gaps ≤300 ms, drops <2 s). `scripts/worker.ts` — the drain loop.
- `lib/analysis/budget.ts` — `recordSpend`, `wouldExceedBudget`, `monthToDateSpend`. `lib/lessons/{generate,grade}.ts` — the text-model billed calls.
- Migrations are append-only in `lib/migrations/index.ts` (latest **v7**); add **v8** if you need schema.

## Acceptance criteria

Each becomes at least one regression test that **fails against the current code** and passes after.

1. **Cache-reuse must remap timestamps onto the target session.** `reuseCachedFindings` currently clones the donor finding's `start_ms`/`end_ms` verbatim (`lib/analysis/findings.ts:223-248`), but those are absolute offsets on the **donor's** timeline. Reproduced: donor segment at 10–14 s, byte-identical audio at 3600 s in another session → the cloned finding reads `startMs=11000`, outside the target segment entirely. Fix: remap on clone — `newStart = donorFinding.start − donorSegment.start + targetSegment.start` (same for end), clamped to the target segment's bounds; the cascade already holds the target segment. (Test: an offset-shifted duplicate hash produces findings inside the target segment's range; a same-offset duplicate is unchanged.)
2. **Job claim must use a heartbeat lease.** `reclaimStuckJobs`/`reclaimStuckAnalysisJobs` return **every** `processing` row with no staleness check, and `scripts/worker.ts` reclaims on every tick — so a second worker process re-runs a job the first is actively executing (double OpenAI spend, duplicate findings, doubled cards, inflated metrics). Fix: claim with a worker identity + a heartbeat timestamp refreshed as the job progresses; reclaim **only** rows whose heartbeat is older than a documented stale threshold (comfortably longer than the slowest checkpoint). Additionally add an **insert-if-absent guard** on `findings` (a uniqueness key over session+content_hash+start_ms+quote, or an equivalent pre-insert check) as belt-and-braces. (Test: a simulated second claimant cannot take a job whose heartbeat is fresh, *can* take one whose heartbeat is stale, and a double-run of the same segment yields exactly one set of findings.)
3. **VAD must bound segment length.** `speechIntervals` merges but never splits, so continuous background sound (café, TV) yields one multi-hour "speech" segment — which `cascade.ts` then reads whole into a Buffer and base64-encodes for the API, breaking analysis at exactly the day-scale D-9 promises, *after* the triage was billed. Fix: a documented `MAX_SEGMENT_MS` (3–5 min); any longer interval is split at the quietest contained dip, falling back to a flat cut at the cap when no dip exists. (Test: a long continuous-tone fixture yields multiple segments each ≤ cap, timestamps remain contiguous and correctly ordered, and total speech time is preserved.)
4. **Spend must be recorded when a billable call resolves, not after parsing.** Today a call that returns 200 but fails JSON parsing charges OpenAI while the ledger records nothing, and the retry bills again — so the "hard cap" caps only *recorded* money, understating exactly when things go wrong. Fix: record the charge at resolution, independent of parse/persist success, in **both** engines (`lib/analysis/*` and `lib/lessons/{generate,grade}.ts`) — while **preserving** E-4's atomicity guarantee that a *successful* segment's spend, findings, and witness still commit together (do not regress `tests/analysis-atomicity.test.ts`). (Test: a mocked call whose response fails to parse still produces a ledger row of the right cost, and the existing atomicity test still passes.)

## Files and constraints

- Keep each fix minimal and surgical; this is a hardening PR, not a refactor. **Out of scope for restructuring:** the findings read-model consolidation and SQL aggregates — those are E-17.
- All tests run with **no network** (mocked clients, fixtures). Never commit anything under `data/`.
- Files < 500 lines; Conventional Commits; hooks armed; the `gates` CI check must pass. Playwright specs (if any) use a fresh/isolated DB per run.
- Migration v8 only if genuinely required (e.g. the findings uniqueness key or heartbeat columns); append-only, never edit v1–v7.

## Out of scope (do not touch)

- E-16b's sweep: mic-take silent drop, 404-keeps-polling, `data/cache` eviction + temp sweep, Erika's pinned NUL pre-commit hook, and the polish fold-ins.
- E-17 (findings read-model, SQL aggregates, schema doc) and every later v0.3 milestone.
- Model prompts, rates, the cascade's shape, the SM-2 scheduler, and all UI surfaces.

## Milestone ritual (this PR)

E-16 completes in part 2, so set **FEATURES.md E-16 `next → building`** (not `done`). Leave STATE.md accurate; a one-line "E-16 in progress: integrity core landed" note is fine.

## PR description must state

Per defect: the reproduction, the fix, and **explicit evidence the new test fails against the pre-fix code** (how you verified it). Plus the exact verification commands and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.
