# RUN-008 — Italian lessons prepared ahead

Date: 2026-07-26 · Mode: direct · Dispatcher: GPT-5.6 Sol · Target: github.com/immaculatecross/erika

## Preflight

- [x] Canonical mfactory checkout known at `/Users/mattiamauro/Desktop/Murder she wrote/mfactory-v2`; mfactory frozen for the run.
- [x] Harness CLI ready: Claude Code 2.1.220; Cursor fresh-session workers also available.
- [x] Author identity authenticated: `gh auth status` = `immaculatecross`.
- [x] Review path ready: master requires zero approvals; a fresh Full reviewer verdict remains mandatory under the playbook.
- [x] Remote and protection verified: `origin` = `immaculatecross/erika`, PRs and linear history enforced, required check `gates`, force-push/deletion disabled.
- [x] Default-branch baseline verified: lint green with three pre-existing unused-import warnings; 1472 tests green; build green with the pre-existing sherpa dynamic-import warning; tripwires green; typecheck green after rerun sequentially. The first concurrent typecheck raced the build's `.next` rewrite and was a tooling false red.
- [x] Work order written: `.mfactory/work-orders/WO-E47-italian-lessons-ahead.md`.
- [x] Operator's unrelated local edit identified and isolated: six-line last-card render guard in `components/session/drills-step.tsx`; workers must use a separate worktree and never stage it.

## Mission

Operator chose option B: teaching content is entirely Italian and the complete next lesson is prepared and cached before session launch, rather than generated when the learner opens it. This becomes E-47, the operator-directed first milestone of v0.8. Work order: `.mfactory/work-orders/WO-E47-italian-lessons-ahead.md`.

## Scope and run shape

One user-recognizable milestone, one work order, one PR, solo and serial. Full review is mandatory because preparation touches generated-content validity, cache invalidation, concurrency/claims, migrations or data deletion, and the shared money spine.

The rolling horizon is one composer-selected lesson; the milestone does not pre-generate the 30,786-lemma lexicon. The Italian authored syllabus is the offline path. Global application chrome remains English.

## Timeline of facts

- 2026-07-26 14:08 CEST — diagnosis established that syllabus explanations and generated lessons were English and generated lessons were first written on lesson launch.
- 2026-07-26 14:10 CEST — operator selected option B: Italian teaching plus pre-generation before launch.
- 2026-07-26 14:12 CEST — mission scoped as E-47, Full review, solo/serial; baseline gates and branch protection verified.
- 2026-07-26 14:14 CEST — WO-E47 and RUN-008 opened.
- 2026-07-26 14:15 CEST — fresh worker dispatched into an isolated worktree; branch pushed before implementation.
- 2026-07-26 14:48 CEST — PR #94 opened at commit `94d90ac`; worker reported 1511 tests, lint, typecheck, build, tripwires, mutation proof, and disposable built-browser walkthrough green. Live keyed generation remained operator-gated because the isolated worktree had no key. Required CI `gates` still running.
- 2026-07-26 14:52 CEST — required CI `gates` passed; PR mergeable.
- 2026-07-26 15:07 CEST — Full review requested changes with four demonstrated blockers: language false accepts/rejects; planner-level vocabulary-only omission; stale-claim duplicate billing/overwrite; three malformed or false authored syllabus rules. Reviewer independently completed the live keyed call for `$0.0010724` and verified the model-free built flow.
- 2026-07-26 15:08 CEST — dispatcher priced all four blockers as repair-required and dispatched the one allowed repair cycle.
- 2026-07-26 15:19 CEST — a second independent Full lens against the same original SHA found one additional blocker: onboarding routes directly to `/practice/session`, bypassing the Learn-home preparation effect, so `/api/session/start` returns a permanent 409 until the learner navigates away; an abandoned claim creates the same wall despite an authored lesson being immediately available. This is queued into the repair/delta gate and cannot be waived.
- 2026-07-26 15:22 CEST — repair commit `905dad2` pushed: language validation, offline vocabulary planning, claim ownership/timeout, and authored corrections.
- 2026-07-26 15:26 CEST — repaired required CI `gates` passed; PR mergeable. Delta review dispatched against all five blocking harms, including the late onboarding finding.
- 2026-07-26 15:35 CEST — delta review requested changes. Four original harms closed; onboarding/abandoned-claim Start wall remains. Repair introduced one money-safety blocker (a client resolving after timeout is billed but leaves zero ledger rows) and two unreal tests (aggregate language guard and claim-token ownership can be removed without failure). This is the second failed review; per `review.md`, mission escalated to the operator rather than dispatching an automatic second repair.
- 2026-07-26 15:44 CEST — operator directed “Finish,” authorizing one exceptional second repair plus a final delta review. Merge remains forbidden until the onboarding wall, unrecorded timeout spend, and both unreal tests are closed.
- 2026-07-26 15:49 CEST — exceptional repair `bf4eb22` pushed: Start now keys on servability, ambiguous timeout spend commits conservatively once, and both guard tests are mutation-sensitive.
- 2026-07-26 15:53 CEST — required CI `gates` passed at `bf4eb22`; worker reported 1521 tests, built onboarding/abandoned-claim proofs, and one committed conservative timeout charge. Final delta review dispatched.
- 2026-07-26 15:59 CEST — final delta closed all four standing blockers but found one repair-introduced session-stability race: Start can serve authored grammar during a healthy active claim, then lesson GET switches the already-open session to generated vocabulary when that claim completes. Operator's “Finish” direction remains active; one last focused stability repair required before merge.
- 2026-07-26 16:47 CEST — stability worker died on an API-limit switch after leaving a durable partial patch in the isolated worktree (Start pin helper + tests, uncommitted). Fresh completion agent dispatched against that partial state.
- 2026-07-26 16:51 CEST — pin repair `a9e840a` pushed: Start atomically fills an empty claim with authored Italian and clears claim ownership so a late healthy preparation cannot change lesson GET, drills, or cued evidence while still finalizing accepted-call spend once. Required CI `gates` in progress; final delta review waits for green.
- 2026-07-26 16:55 CEST — required CI `gates` passed at `a9e840a`; pin final delta review dispatched.
- 2026-07-26 16:56 CEST — pin final reviewer died on an API-limit switch with no durable verdict; fresh independent reviewer dispatched against the same head.
- 2026-07-26 16:58 CEST — pin final review APPROVE at `a9e840a`; standing session-stability blocker closed; no new blockers.
- 2026-07-26 16:59 CEST — PR #94 squash-merged to `master` as `fcbb86a`. Dispatcher FEATURES/STATE ritual opened.

## What broke or fought back

- Baseline typecheck was first run concurrently with the production build. Next rewrote `.next/types` while TypeScript read it, producing missing-file errors; rerunning after build passed. Encoded in WO-E47 gate instructions.
- The worker's language fixtures were narrower than ordinary model prose, so a detector that passed its mutation test still accepted a complete all-English lesson and rejected valid Italian. CLOSED by `905dad2`.
- A direct helper test proved vocabulary fallback while the real planner prevented that helper from receiving a keyless vocabulary item. CLOSED by `905dad2`.
- The 15-minute empty-claim sweep assumed model calls finish quickly, but production fetch had no timeout and claim completion had no ownership token. Original harm CLOSED by `905dad2`; timeout understatement CLOSED by `bf4eb22` (conservative upper-bound commit).
- The readiness gate tested claim state rather than whether a lesson could be served. CLOSED by `bf4eb22` servability + onboarding/abandoned proofs.
- Two repair tests were mutation-insensitive. CLOSED by `bf4eb22` with failing mutation proofs.
- The servability repair did not pin the chosen body, allowing a healthy preparation to swap the open session. CLOSED by `a9e840a` Start pin.
- Two API-limit deaths (stability worker, pin reviewer) forced fresh re-dispatch; partial work survived because it was left on disk. Encoded as: durable partial worktrees + re-dispatch, not nursing a dead session.

## Component scorecard (worked | fought | broke)

| Component | Verdict | One-line note |
|---|---|---|
| Work order | worked | Product boundary, money/cache risks, and observable language behavior stayed explicit through repairs. |
| `task.md` worker | fought | Delivered, then needed one allowed repair, one operator-authorized exceptional repair, and one pin completion after an API-limit death. |
| `review.md` reviewer | worked | Found real product-boundary and money harms green suites missed; final pin review approved. |
| Dispatch loop | fought | Correctly escalated after the second failed review; operator “Finish” unblocked; API-limit deaths required fresh agents. |
| Hooks & gates | fought | Concurrent build/typecheck races on `.next`; sequential rerun green throughout. |
| Artifacts | worked | WO, RUN-008, and review verdicts survived session deaths. |

## Signals

| Signal | Value |
|---|---|
| Sessions: workers / reviews / other | 4 workers (initial + repair + exceptional + pin) / 4 reviews (two Full lenses + delta + pin final) / 0 |
| Outcomes: first-pass approvals / repairs / escalations | 0 / 3 repair commits / 1 operator appeal |
| Routing misses · hook blocks · interruptions | 0 · 0 · 2 API-limit deaths |
| Cold-start walkthrough | n/a (milestone, not version close) |
| Wall clock per role | ~2.8 h wall (14:14–16:59) |
| Tokens per role | n/a |

Pass ledger: `WO-E47-italian-lessons-ahead: repaired (exceptional + pin) then approved`.

## Lessons

- L: Build and typecheck both mutate/read `.next/types`; running them concurrently creates a false baseline failure. → encoded as: WO-E47 gate instructions require sequential execution.
- L: A helper test that never reaches the planner/product boundary can prove an unreachable path. → encoded as: vocabulary-offline and onboarding/abandoned Start product-boundary tests.
- L: Servability without pinning invents silent lesson swaps inside a frozen session. → encoded as: `pinServableItemLesson` at Start.
- L: Timeout without an observer invents unrecorded spend; prefer conservative over-recording on ambiguous accepted calls. → encoded as: finalize reserved upper bound on timeout.
- L: Mutation-insensitive repair tests are unreal tests. → encoded as: aggregate-language and claim-token ownership mutation proofs.
- L: API-limit deaths lose live agents; durable partial worktrees and re-dispatch beat nursing. → OPEN for factory retro.

## Verdict

CLOSED. E-47 merged as PR #94 (`fcbb86a`). Italian teaching content is prepared before launch, Start pins the promised body, and the money spine remains conservative. Would dispatch the next v0.8 milestone on today's mfactory, with the standing note that formal GitHub review state still relies on the author-account comment path until a second reviewer identity exists.
