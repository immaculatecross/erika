# RUN-007 — v0.7 the simplification (E-42…E-46)

Date: 2026-07-25 · Mode: direct · Dispatcher: Claude Opus 5 (1M), local session · Target: github.com/immaculatecross/erika

Filed here rather than in `mfactory-v2/runs/` because **no mfactory checkout is reachable from this machine** (`../mfactory-v2`, `~/mfactory-v2` and the sibling desktop path all absent). Sync back to the mfactory archive when a checkout exists — part of filing, not a favour (mfactory D-17).

## Preflight (dispatch.md step 4)

- [x] `<mfactory>` — **not reachable**; the pinned kit at `.mfactory/` is the fallback, as `HANDOVER.md` sanctions. Kit last synced 2026-07-21 against mfactory D-01…D-17; it is frozen for this run (M-2).
- [x] Harness answers: Claude Code, Agent-tool dispatch (cloud-mode plumbing per `HANDOVER.md` §Cloud dispatcher sessions — no `claude -p`).
- [x] Author identity authenticated: `gh auth status` → `immaculatecross`, scopes `gist, read:org, repo, workflow`.
- [x] Reviewer identity: single-identity fallback (Erika D-11 — branch protection is deliberately zero-required-approvals; the dispatcher merges on the reviewer session's verdict). Reviewers are fresh sessions that never see the builder's reasoning.
- [x] Target repo remote + branch protection verified live: PRs required, `required_approving_review_count: 0`, `required_linear_history: true`, `allow_force_pushes: false`, **`required_status_checks.contexts: ["gates"]`**. → **The dispatcher-owed item STATE.md still lists as open ("add the `gates` CI check to branch protection") is already done.** Corrected in STATE at close.
- [x] Node 20.9.0 · ffmpeg 7.1 · ffprobe 7.1 — all present (D-7).
- [~] **Gates green on `master` before dispatch — with one honest exception, recorded rather than waived.** `lint` clean, `typecheck` clean, `build` clean, `test` **1010/1012**. Both failures are in `tests/coldstart-keyless-worker.test.ts` and both are the *same defect in the test*, not in the product (see below). CI is green on the same commit because CI has no `.env.local`. Not treated as a poisoned baseline: the failures are host-dependent and fully explained, and the fix is assigned inside this run (WO-E42).
- [x] Work orders written at `.mfactory/work-orders/WO-E4{2,3,4,5,6}-*.md`, every section filled.

### Preflight finding — the flagship cold-start test is only "keyless" on an unconfigured machine

`tests/coldstart-keyless-worker.test.ts:49` spawns `scripts/worker.ts` with `cwd: process.cwd()`, so the worker loads the **repo's real `.env.local`**. On the operator's machine the key is present, so:

1. the assertion `expect(out).toMatch(/ingest will run normally/i)` fails — the worker printed its *keyed* startup line;
2. the second test's assertion that analysis fails with `"no OPENAI_API_KEY is set…"` fails because the worker **made a real, billed call to OpenAI** and got back `gpt-audio call failed: 500 Internal S…`.

The test that exists to prove v0.6's cold-start blocker stays fixed is therefore green in CI, red on a developer machine, and **spends money when it runs**. It is the third instance in this repo of a test whose subject is not what it claims (v0.6's `decodeURIComponent` grep; the hand-built Next route context; now this). Assigned to WO-E42 with the invariant stated: *a cold-start test must construct the cold start, never inherit the host's.*

## Mission

Operator, 2026-07-25, verbatim in substance: *"Enrich the current v0.7 … this is not really a great polished usable consumer product … a good consumer product like Duolingo would have just one session per day, very clear, no questions asked, super polished, super straightforward"* — plus a specific defect and direction list (realtime tutor speaks poor Italian → TTS+STT; simplify the lesson; flashcards showing the literal word "grammar"; force onboarding on an empty DB; no buttons on the recording path; hide live costs; show progress). Restated mid-planning: *"we did lots of things maybe overcomplicating a lot of stuff. We wanna have a sleek consumer product."*

Ratified as **D-26** and scoped as **v0.7 = E-42…E-46** in FEATURES.md. Operator answers taken at dispatch time: simplify **absorbing** the E-39 owed defects on each rewritten surface; demote-don't-delete with demoted surfaces allowed back into the daily flow where they earn it; **live-API spend ceiling $5** for the whole run; progress gets a real surface.

## Timeline of facts

- 2026-07-25 09:20 — Fetched origin; local `master` already at `11eaa14`… (`11aeb14`), no drift. Five stale remote `fix/*` branches noted, not touched.
- 2026-07-25 09:24 — OpenAI key verified **valid** (bogus key → 401, real key → 500) but the API was in *Partial System Degradation* returning HTTP 500 on every endpoint. Recorded because it gates the live-verification parts of this run.
- 2026-07-25 09:30 — Recon of the six user-facing flows completed (findings folded into the work orders).
- 2026-07-25 09:35 — Baseline gates run; preflight finding above recorded.
- 2026-07-25 09:36 — Inherited **PR #66** (`feat/e39-catch-all-mistakes`, WO-E39 workstream A, gates green, `MERGEABLE`/`CLEAN`) found open from a prior session. Full review dispatched.
- 2026-07-25 09:36 — Voice spike dispatched (live measurement, ≤$1 of the $5 ceiling) → `docs/research/spike-5-voice-loop.md`.

<!-- appended as the run proceeds -->

## What broke or fought back

- **The cold-start keyless test inherits the host environment and bills for it.** Symptom → root cause → fix: see the preflight finding. Assigned WO-E42. OPEN until then.
- **OpenAI degraded during planning.** All endpoints 500 at 09:24 UTC. Mitigation: the spike retries with backoff and is briefed to deliver a partial, labelled result rather than fabricate numbers.

## Component scorecard (worked | fought | broke)

| Component | Verdict | One-line note |
|---|---|---|
| Work order (template + this instance) | | |
| `task.md` worker | | |
| `review.md` reviewer | | |
| Dispatch loop (`dispatch.md`) | | |
| Hooks & gates | | |
| Artifacts (STATE/LOG/FEATURES fidelity) | | |

## Signals (countable facts)

| Signal | Value |
|---|---|
| Sessions: workers / reviews / other | |
| Outcomes: first-pass approvals / repairs / escalations | |
| Routing misses · hook blocks · interruptions | |
| Cold-start walkthrough | pending |
| Failure-path walkthrough | pending |
| Live API spend (ceiling $5.00) | |
| Wall clock per role (workers / reviews / dispatcher) | |
| Tokens per role, where the harness reports them | |

Pass ledger — one line per dispatched unit: `WO-<slug>: first-pass | repaired | escalated`.

- `PR-66 (WO-E39 workstream A, inherited)`: pending

## Lessons (D-09: each names its encoding, or is marked OPEN)

- L: A test that constructs a "clean" environment by *omission* inherits whatever the host supplies — and can silently reach a live, billed API from a developer's machine. → encoded as: WO-E42 criterion (explicit env construction + a no-network assertion), pending.

## Verdict

<!-- filled at mission end -->
