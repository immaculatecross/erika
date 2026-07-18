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

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/21  (feat/hardening-core → master, `gates` green)

Changed:
  - lib/analysis/findings.ts — reuseCachedFindings takes the target segment and REMAPS donor
    timestamps onto it (offset-within-segment re-anchored, clamped); ON CONFLICT DO NOTHING on
    the v8 identity index in both writers (targeted, so CHECK violations still throw).
  - lib/jobs/lease.ts (new) — claimQueued / reclaimStale / heartbeat / workerId shared by both
    queues; JOB_LEASE_STALE_MS = 15 min, documented against the slowest checkpoint.
  - lib/ingest/pipeline.ts, lib/analysis/cascade.ts — claim + reclaim via the lease; heartbeat at
    every checkpoint and per segment (extract, render, cascade loop).
  - lib/ingest/vad.ts — MAX_SEGMENT_MS = 4 min; splitLong cuts long intervals at the quietest
    contained dip's midpoint within a bounded window, flat cut as fallback; SPLIT_FILL = 0.85.
  - lib/analysis/cascade.ts billedCall + lib/lessons/billing.ts parseBilledResponse (used by
    generate.ts and grade.ts) — ledger the charge when a billable call RESOLVES, not after parse.
  - lib/migrations/index.ts — v8: worker_id/heartbeat_at on both job tables; dedupe + UNIQUE
    idx_findings_identity. Append-only; v1–v7 untouched.
  - scripts/worker.ts — comment only (the lease defaults carry the process identity).
  - tests: +16 (cascade remap ×3 & spend-on-resolve ×2, vad split ×5, lease ×3 + findings guard,
    migrations v8 ×2, lessons parse-failure ×2). Two pre-existing tests that asserted the
    DEFECTIVE contract were inverted, not deleted, with the reason in a comment at the site.
  - FEATURES.md E-16 next → building; STATE.md one-line in-progress note.

Verified:
  - npm run typecheck / lint / test / build — all clean; 234 tests pass (was 218).
  - EACH new test verified to FAIL pre-fix by reverting only that defect's fix, running, then
    restoring. Observed failures: D1 "expected 11000 to be 3601000" (the donor's timestamp
    surviving the clone); D2 "expected [Array(1)] to deeply equal []" (a live job stolen) and
    "expected […,…] to have a length of 1 but got 2" (duplicate findings); D3 "expected 1 to be
    greater than 1" (one multi-hour segment); D4 "expected ['gpt-audio-mini'] to deeply equal
    ['gpt-audio-1.5','gpt-audio-mini']" and "expected [] to have a length of 1" (unledgered
    charges). Two control tests pass either way by design and are labelled as controls.
  - E-4 atomicity intact: tests/analysis-atomicity.test.ts passes UNMODIFIED, rollback case
    included. The success path never writes in the new code — only the failure path does.
  - Real end-to-end drive with real ffmpeg (not just unit tests): a 14-minute unbroken tone
    through processJob → 5 contiguous segments of 168 s, each ≤ the 240 s cap, real files
    extracted and hashed; the fresh heartbeat left behind made reclaim by a second worker
    return []. Scratch spec removed before committing.
  - No network in any test (mock AudioModelClient / TextModelClient, synthesized fixtures).

Risks:
  - JOB_LEASE_STALE_MS = 15 min is a judgement call; a normalize pass exceeding it on slow
    hardware could still be reclaimed live. Beating inside long ffmpeg stages is the real fix
    and is a refactor, out of scope here.
  - MAX_SEGMENT_MS changes segmentation for continuous audio, so such sessions' cached hashes
    no longer match and would be re-analyzed (re-billed) once. Discrete speech is unaffected.
  - Migration v8 deletes duplicate findings (cascading to their cards) — duplicates by
    construction, and unavoidable for the unique index to build; covered by a migration test.
  - Diff ~836 lines vs the WO's ~400 guidance; ~384 of it is the four regression suites. Per
    task.md I did not trim tests to fit. Flagged in the PR body.

Blocker:  none
```
