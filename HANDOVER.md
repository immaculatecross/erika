# Handover — picking this build up in a fresh session

> For a new dispatcher session (local or cloud) taking over Erika. Everything the loop needs is in this repo; this file covers only what the other files can't tell you. Read it after `AGENTS.md` and before your playbook.

## Boot order

`AGENTS.md` → `STATE.md` → `FEATURES.md` → `DECISIONS.md` → this file → `.mfactory/playbooks/dispatch.md`. `DESIGN.md` is binding for any UI change.

## The factory's rules live in a second repo — read it

**github.com/immaculatecross/mfactory-v2** is canonical for how the loop is run. This repo's `.mfactory/` is a *pinned copy* and can lag. Read mfactory's `DECISIONS.md` — in particular **D-11** (post-version retro), **D-12** (mid-run retro authority), **D-13** (fixture realism), **D-14** (a real test can assert the wrong contract), **D-15** (the dispatcher prices findings), **D-16** (throughput) — and its `runs/`: `RUN-001`, `RUN-002`, `RUN-003` and `RETRO-001` carry the full history, the adjudication ledger, and the open lessons.

⚠️ **Both repos have a `D-16` and they are different things.** Erika's D-16 ratifies the v0.3 scope; mfactory's D-16 is the throughput decision. Cite the repo when you reference either.

**If the pinned kit lags mfactory, re-sync it** (`playbooks/`, `templates/`, `hooks/`) as a small docs PR before dispatching — otherwise fresh workers and reviewers boot from stale discipline. Last synced **2026-07-21** against mfactory `D-01…D-17` (see below).

## Environment (a fresh sandbox will not have these)

1. **`OPENAI_API_KEY` in `.env.local`** — gitignored, never committed. The worker now refuses to start without it and says so. Needed from E-19 on; E-17/E-18 are model-free.
2. **`ffmpeg` and `ffprobe` on PATH** (D-7). The whole ingest path — normalize, VAD, segment extraction, renditions — shells out to them. Without ffmpeg the app builds and read-model milestones pass, but anything touching audio fails. `.github/workflows/ci.yml` shows the install.
3. **Node 20+**, and **`gh` authenticated** as the author identity — branch protection requires PRs and the dispatcher merges.
4. **Verify all of the above before a long unattended run.** A run that discovers a missing key at milestone four has wasted the first three.

## Cloud dispatcher sessions — the plumbing differs, the loop doesn't

A dispatcher running in a managed cloud sandbox (e.g. Claude Code on the web) hits three deltas a local checklist won't mention. **(1) No `gh` CLI** — GitHub operations (PRs, reviews, CI state, merges) go through the harness's GitHub tools instead; the review playbook's `gh pr review` becomes: the fresh reviewer session produces the verdict body, and the dispatcher relays it as a PR review/comment and merges on it (the same D-11 single-identity fallback). **(2) The mfactory checkout is not at `../mfactory-v2`** — add the repo through the platform's repo-add mechanism and use wherever it lands; the pinned `.mfactory/` kit here is the fallback if it can't be reached. **(3) Fresh worker/reviewer sessions are spawned via the harness's agent mechanism**, not `claude -p` — same isolation contract (the work order is the worker's entire briefing; the reviewer never sees the builder's reasoning), different invocation. Item 3 of the environment list above ("gh authenticated") reads accordingly in cloud mode. Everything else — boot order, work orders, tiers, pricing, the ritual — is unchanged; the 2026-07-18 mid-RUN-003 handoff ran cold from these files alone.

## Two processes, always

`npm run dev` serves the UI and only **enqueues** work. `npm run worker` drains ingest and analysis jobs. Without the worker, uploads sit `queued` forever — the UI now says so instead of showing a calm badge.

## How to run the loop (mfactory D-16 — this is new, and it matters)

The previous run was measured at **74% worker time, 100% sequential**; that was the bottleneck, not review.

- **Parallelize milestones that are genuinely independent** — each worker in its own **git worktree**, merges always **serialized**. Required for a batch: no shared contract between them (anything rewriting a shared read-model runs alone); **at most one migration** (versions collide); **the dispatcher performs the FEATURES/STATE ritual once after the batch merges** — parallel workers must not, or every PR conflicts on those two files; each PR rebased with `gates` re-run before its own merge; width ~3–4; and the independence rationale recorded.
- **No diff-line cap.** One milestone, one PR; size follows the milestone. Don't split into a/b — six such splits cost ~2.4 h last run while the cap was exceeded anyway. The per-file 500-line hook is the real guard.
- **Pipeline** — dispatch worker N+1 while review N runs, unless N+1 depends on N's output.
- **Declare a review tier** in every work order: **Full** (never skippable — money/billing, migrations/schema, data deletion, secrets, concurrency/leases, the ingest or analysis correctness path, external contracts), **Light** (timeboxed fidelity + obvious harm), **None** (gates only; the automated gates always run). A worker may **raise** a tier, never lower it.
- **Price findings; don't obey them (D-15).** A BLOCKING verdict is a demonstrated harm handed to you — weigh it against deployment context and either require one repair, accept it as a recorded limitation and merge, or defer it. One repair cycle, then decide. **Never waivable:** real-user-data loss, secret exposure, unrecorded spend.
- **Don't nurse a failing session (mfactory D-17 wave).** Correcting a live session is capped at two attempts per problem; after the second failed correction, kill it and dispatch fresh with an amended brief naming the failure. Infrastructure deaths (spend limit, network) don't count against this — re-dispatch the same brief.
- **Cold-start walkthrough before closing a version (mfactory D-17 wave).** Dispatch a fresh, no-context session: clean clone, only the repo's own written instructions, drive Erika's core promise (upload real speech → reach findings) with one real input, once. Its entire output is `PASS`, or `FAIL` plus the first broken step, quoted. ~20 min, judges nothing else. A FAIL is a defect of the *closing* version — fix before declaring it closed. This is the direct answer to the three field failures below: the seam class they lived in (env loading, silent stalls, a path never once run) now has an owner.
- **The errand lane (`.mfactory/playbooks/errand.md`, new).** A bounded standalone task from the operator — PR triage, a diagnosis, a small fix on a Light/None surface — doesn't need a work order or a dispatcher: one session, strongest model, real verification, full platform gates. It structurally cannot touch a Full-tier surface or exist inside a mission; anything bigger routes to `dispatch.md` as normal.
- **Run reports carry a Signals block now** (`templates/run-report.md`) — sessions, outcomes, routing misses, hook blocks, wall clock/tokens per role, a pass ledger. Fill every row; "n/a" is an answer, blank is not.
- **mfactory's `runs/` is the permanent cross-product archive (mfactory D-17).** Before declaring a mission closed, sync the filed run report back into `mfactory-v2/runs/` and push it there — this is part of filing, not optional housekeeping. It feeds `factory-retro.md`, mfactory's own self-improvement checkpoint (advisory only, operator-ratified — it never edits Erika or itself).

## Context a cold session cannot infer

- **The dev database is disposable.** Delete `data/` freely; it regenerates. Do **not** do migration archaeology to preserve test rows — that mistake cost a full repair cycle and an escalation.
- **"Shipped" is not a git property.** A migration is shipped once *applied anywhere*, because the runner reads `_migrations` on disk, not git. Amend-before-merge is only safe while every database holding it is disposable.
- **Fixtures prove mechanism, not judgment (D-13).** Where a criterion pins a threshold or parses another system's output, demand a real *labelled* sample or an explicit "uncalibrated" note plus truthful degradation. Two production bugs reached the operator through fixtures built to be easy.
- **A real test can still assert the wrong contract (D-14).** Two shipped tests encoded defects *as* the contract and ~20 reviews passed them. Read assertions as specifications — especially any test a diff changed or deleted; this reading now applies at every review tier, including Light.
- **Verify against disposable state, always (`task.md`, generalized from the lesson below).** Throwaway paths, temp databases, sandboxed config — never the product's default data path, a real account, or a live external side effect unless the work order says so.
- **Encoded, formerly OPEN:** verification runs targeting the product's default data path (`data/erika.db` — an agent did, and pushed an unmerged migration onto the operator's real database) and the missing "new user, clean checkout, reaches findings" path are both now covered — the first by the disposable-state rule above, the second by the cold-start walkthrough. Watch one version to confirm the walkthrough actually catches this class before treating it as closed for good.

## Operator-owed

- **Rotate the founding OpenAI key** — it transited a chat channel at founding.
- Optional: a **GitHub App reviewer identity** so verdicts become native approvals (mfactory M-4). Not required — branch protection is deliberately zero-required-approvals (Erika D-11) and the dispatcher merges on the reviewer session's verdict.

## Deferred, with reasons

**v0.4 candidates:** *Targets* (assignments Erika verifies in your next recording — the strongest idea from RETRO-001, deferred only because it needs E-19/E-20 to mature), pagination, `data/cache` eviction, the cosmetic polish list from RETRO-001, and the older backlog — E-8 pronunciation studio, E-10 conversation gym, E-13 voice enrollment, E-14 hosting + OAuth, E-15 companion/mobile.
