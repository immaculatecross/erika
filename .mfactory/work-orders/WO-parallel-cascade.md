# WO-parallel-cascade — Parallel cascade & spend reservations (E-27)

Target repo: immaculatecross/erika · Branch: `feat/parallel-cascade` · **Review tier: Full**
<!-- Full, never skippable: this is the MONEY path (the budget cap), CONCURRENCY/leases, a
     MIGRATION, and the analysis correctness path all at once. The never-waivable class
     (unbounded/unrecorded spend) lives here. Do not lower the tier. -->
<!-- Batch: solo. -->

## Objective

A day-scale dump analyzes in wall-clock minutes, not hours, without ever billing past the cap. Today `lib/analysis/cascade.ts` walks segments **serially**, and `wouldExceedBudget` reads only *committed* spend before each call — correct only because one call is ever in flight. E-27 runs the per-segment cascade through a **bounded concurrency pool** (env-capped, default ~6) inside one analysis job, and converts the budget guard to **reserve-before-call**: a call reserves its estimated cost as a *pending* ledger entry **atomically** before it fires, the cap counts committed **+ pending**, the reservation is **finalized to the real cost on resolve** (or released on failure/no-charge), and **abandoned reservations are swept at startup**. A long parallel run stays alive via an **interval heartbeat**; transient `429`s get a **bounded, jittered retry honoring `Retry-After`**; progress counts completions. When this is done a 12 h dump lands in ~10–20 min and **the cap cannot be overshot even with the whole pool racing** — the constant-wall-clock property E-28's richness dial needs before it opens spend.

## Acceptance criteria

1. **Bounded per-segment concurrency.** `runAnalysisJob` processes segments through a pool of at most **N** concurrent workers (N from an env var, e.g. `ANALYSIS_CONCURRENCY`, default ~6, floored to ≥1), replacing the serial `for` loop. Cache hits still make zero calls; ordering of findings/witnesses is unaffected; a per-segment failure is still isolated to that segment (the `ModelParseError`→`markUnreadable` behavior and the budget-halt behavior are preserved). A test asserts no more than N model calls are ever in flight at once (inject a client that observes concurrency).
2. **Reserve-before-call — the cap counts committed + pending, atomically.** Before any billable call, the estimated cost is reserved as a **pending** entry in one atomic step that **refuses if committed + pending + this cost would exceed the cap** — two racers can never both pass such that their sum overshoots (do the check-and-insert in a single SQLite transaction / conditional insert; a test spawns many concurrent reservations against a tight cap and asserts total *committed* never exceeds it and the number admitted is exactly what fits). On the call resolving, the reservation is **finalized to the actual cost** (the existing atomic "commit spend with findings + witness in one transaction", E-4 criterion 5, is preserved — now it finalizes the reservation rather than inserting a fresh committed row). A **no-charge** outcome (`ModelUnavailableError` / network, no completion) **releases** the reservation (zero committed). A **parse-failure** (`ModelParseError` — OpenAI answered and charged) **finalizes** the reservation to its charged cost (never released — the E-16 defect-4 guarantee: a body that failed to parse still bills). Net: **exactly one committed ledger row per real charge, none lost, none doubled, never over the cap.**
3. **Startup sweep of abandoned reservations.** A crash between reserve and finalize leaves a pending row; a startup sweep (mirroring the E-16 job-lease reclaim and the E-21/E-23 lease-before-spend sweeps) releases pending reservations older than a stated TTL so they stop counting against the cap. `monthToDateSpend`/`wouldExceedBudget`'s **committed** semantics for *display* are unchanged (Settings month-to-date shows committed spend, not reservations). A test: a stale pending row is swept and stops blocking new reservations; a fresh one is retained.
4. **Interval heartbeat while calls are in flight.** The job's lease is refreshed on an interval for the whole run (not once per segment), so a long parallel batch is never mistaken for a crashed worker and reclaimed mid-flight (the E-16 defect-2 double-billing guard must still hold — a live job is never reclaimed). The interval is cleared on completion/failure. A test asserts the lease stays fresh across a run longer than the stale threshold.
5. **Bounded, jittered 429 retry honoring Retry-After.** A `429`/rate-limit response is retried a bounded number of times with jittered backoff that honors a `Retry-After` header; exhausting retries surfaces as the existing `ModelUnavailableError` (tries the D-3 fallback model, no charge). A retry that never received a completion reserves/charges nothing. A test drives a client that 429s then succeeds and asserts one committed charge and honored backoff.
6. **Progress counts completions; wall-clock target.** Job `progress` reflects completed segments (atomic counter), monotonic under concurrency. Document (in the PR / a comment) the concurrency math showing a 12 h dump's flagged-segment deep-listens land in ~10–20 min at the default N; a test need not hit real wall-clock but must prove the pool actually overlaps calls.
7. **Migration + schema doc.** The spend-ledger reservation state lands as migration **v15** (e.g. a `state`/`status` column pending|committed + a `reserved_at`, or the shape the code needs), documented in `docs/schema.md` in the same PR (`tests/migrations.test.ts` enforces). Additive; shipped-once; verify against a throwaway DB only.

## Files and constraints

- **Changed:** `lib/analysis/cascade.ts` (pool + reserve/finalize/release wiring + interval heartbeat + completion progress), `lib/analysis/budget.ts` (reserve-before-call API: `reserveSpend`/`finalizeReservation`/`releaseReservation`/`sweepStaleReservations`, and the committed-vs-pending accounting; keep `monthToDateSpend`/`wouldExceedBudget` committed-semantics for display), `lib/analysis/audio-model.ts` (429 retry), `lib/jobs/lease.ts` or `lib/jobs/liveness.ts` if the heartbeat interval belongs there. Migration v15 in `lib/migrations/index.ts`. `docs/schema.md`.
- **Money-safety invariants (never-waivable, D-15):** the cap is hard — committed spend **never** exceeds `monthlyBudgetUsd`, even with the full pool racing; every real charge lands **exactly one** committed row (none lost, none doubled); the parse-failure-still-bills guarantee (E-16 d4) survives; no reservation counts as committed spend for display. If any of these can't be met, report `blocked`.
- **Contracts that must not break:** the cascade's cache semantics (cached segments make zero calls, record nothing), the atomic spend+findings+witness commit (E-4 c5), the budget-halt state (`halted`, findings-so-far kept), the crash-resume behavior (E-16), and `lib/findings-model.ts` as the findings authority. Determinism of findings output is unchanged (only timing/parallelism differs).
- **D-13:** the concurrency cap and the reservation sweep TTL are tunable knobs — state the defaults and that they're conservative; the atomicity tests are the real oracle (a race that overshoots the cap is a demonstrated failure, not a fixture). Isolate one bad segment; never fail the whole run on one segment.
- Hooks armed; Conventional Commits; 500-line/file; no `data/`/`.env*` committed. `ffmpeg` present. **No live API needed** — tests inject a mock `AudioModelClient` (the cascade is built for exactly this). Verify against a throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`.

## Out of scope

- Raising the budget cap / recalibrating `rates.ts` / the richness dial (that is **E-28**, which this milestone unblocks — do not touch spend *levels*, only the concurrency-safety of the *mechanism*).
- Any knowledge/evidence/lexicon work (E-25/E-26), UI/nav, correction-forward (E-29).
- Changing what the models are asked or how findings are parsed (only *when/how many* calls run concurrently and how spend is reserved).
- Cross-job parallelism (multiple analysis jobs at once) — scope is concurrency **within one job**.

## Exit report
<!-- Append per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands, incl.
     the concurrency/atomicity test output) / Tests changed-removed (read as specs, D-14) /
     Risks / Blocker. Verify against DISPOSABLE state. If the cap can be overshot under any
     race you can construct, that is a blocker, not a risk. -->

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/new/feat/parallel-cascade (branch feat/parallel-cascade)
Changed:
  - lib/analysis/budget.ts: reserve-before-call API — reserveSpend (atomic committed+pending<=cap check-and-insert of a pending row), finalizeReservation (pending->committed at actual cost; re-inserts if the row was swept, so a charge is never lost), releaseReservation, sweepStaleReservations (TTL 15min); monthToDateSpend/wouldExceedBudget now count committed ONLY (display + other-biller guard).
  - lib/analysis/cascade.ts: serial for-loop -> bounded pool (runPool, ANALYSIS_CONCURRENCY default 6); reserve/finalize/release wiring via reservedCall/withRepair; interval heartbeat for the whole run (HEARTBEAT_INTERVAL_MS = lease/5, cleared in finally); progress counts completions; startup sweep at job start.
  - lib/analysis/audio-model.ts: bounded jittered 429 retry honoring Retry-After (retryOnRateLimit + backoffDelay + parseRetryAfter + ModelRateLimitError); exhaustion -> ModelUnavailableError (no charge, D-3 fallback). Retries transparent to billing.
  - lib/analysis/findings.ts: persistSegmentFindings finalizes a reservation in the same txn as findings+witness (E-4 c5); legacy `spend` path kept for fixtures/other billers.
  - lib/jobs/pool.ts (new): reusable fail-fast bounded-concurrency pool.
  - lib/migrations/v15-spend-reservations.ts (new) + index.ts: migration v15 — spend_ledger.state (pending|committed, DEFAULT committed) + reserved_at + idx_spend_ledger_pending. docs/schema.md updated (latest v15).
  - scripts/worker.ts: startup sweep of abandoned reservations.
  - tests: analysis-budget (reservation lifecycle + concurrent-race oracle + sweep), analysis-concurrency (pool bound/overlap, end-to-end cap-under-race halt, interval heartbeat freshness), analysis-retry (429 retry, honored Retry-After, exhaustion, one-charge-per-call).
Verified:
  - npm run lint -> no warnings/errors. npm run typecheck -> clean. npm run build -> compiled, all routes/middleware built.
  - npx vitest run -> 70 files, 495 tests pass (was 428 at v0.3 close; migration v15 asserted by migrations.test.ts + schema-doc bind).
  - Atomicity/concurrency PROOF (disposable temp DBs, ERIKA_DATA_DIR): analysis-budget "concurrent reservations against a tight cap" — 40 racers, cap 1.0 / cost 0.1, EXACTLY 10 admitted, held sum <= cap, display=0 while reserved, committed=10*cost after finalize, one committed row per charge. analysis-concurrency end-to-end — 8 workers race 20 all-clear segments at a $0.02 cap: exactly 5 model calls, committed == $0.02 (never over), zero lingering pending. Pool bound: maxInFlight <= N and >= 2 (overlap). Heartbeat: a 2.5s call under a 1.5s stale probe is never reclaimed. 429: retried then success = one committed charge; exhaustion = ModelUnavailableError.
Tests changed/removed: none removed; none rewritten. Only additive (new suites + import additions in analysis-budget.test.ts). All prior money-path specs (analysis-atomicity E-4 c5, analysis-cascade E-16 d4, analysis-unreadable, analysis-recurrence, ingest-worker ledger counts) pass unchanged — reservations finalize to the same one-row-per-charge shape.
Risks:
  - The parse-failure repair retry (E-16 d4) reserves a SECOND time; if the cap can't afford it the run halts (BudgetHalt) rather than marking the segment unreadable — cap-hard wins over the retry, which is the safe direction and never overshoots. Documented; no test regressed.
  - Sweep TTL (15min) and concurrency (6) are conservative tunable knobs (D-13); the atomicity tests, not the numbers, are the oracle.
  - better-sqlite3 is synchronous so reserveSpend transactions never truly interleave; the race tests still exercise the committed+pending accounting (exactly-what-fits), which is the property that matters.
Blocker:  none
