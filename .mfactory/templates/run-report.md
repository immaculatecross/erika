# RUN-__N__ — __MISSION-SLUG__

Date: __DATE__ · Mode: direct | relay | rehearsal (dry run against a scratch target) · Dispatcher: __who/what__ · Target: __repo__

Every mission files one of these into `runs/` in the mfactory repo — including aborted runs. This is the factory's feedback loop: a run that leaves no report taught nothing.

## Preflight (dispatch.md step 4: check every box before the first dispatch)

- [ ] `<mfactory>` (absolute path to this checkout) known; mfactory frozen for the run (M-2).
- [ ] Harness CLI answers: `claude --version` (or the installed equivalent).
- [ ] Author identity authenticated: `gh auth status` shows the factory author account (D-08).
- [ ] Reviewer identity ready: a second account/App token the review session authenticates with — GitHub rejects self-approval. *First-run fallback (sanctioned in `playbooks/review.md` §Verdict):* the reviewer posts a comment review from the author account and the user supplies the formal approval after reading the verdict.
- [ ] Target repo has a remote and branch protection on its default branch: ≥1 approving review, plus its CI checks.
- [ ] Target's own gates run green on the default branch *before* dispatch (a red baseline poisons every judgment downstream).
- [ ] Work order written at `.mfactory/work-orders/WO-<slug>.md`, every section filled.

## Mission

<!-- The mission as received (one line), and the work order it became (path). -->

## Timeline of facts

<!-- Timestamped bullets, facts only: dispatched, branch, PR, CI results, verdict, repairs, merge/stop. -->

## What broke or fought back

<!-- One bullet each: symptom → root cause → fixed-by (commit/file) or OPEN. "Nothing" is a valid, notable answer. -->

## Component scorecard (worked | fought | broke)

| Component | Verdict | One-line note |
|---|---|---|
| Work order (template + this instance) | | |
| `task.md` worker | | |
| `review.md` reviewer | | |
| Dispatch loop (`dispatch.md`) | | |
| Hooks & gates | | |
| Artifacts (STATE/LOG/FEATURES fidelity) | | |

## Lessons (D-09: each names its encoding, or is marked OPEN)

<!-- - L: <lesson> → encoded as: <file/rule/test> | OPEN -->

## Verdict

<!-- Would you dispatch the next mission on today's mfactory unchanged? If not, what must change first? -->
