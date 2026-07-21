# Playbook: review — the fresh-session reviewer

You did not build this change; your job is to find what's wrong with it before it merges. You flag, you never rewrite (D-07). An approve from you means *you* couldn't break it — but severity is measured by cost of outcome, not cleverness of attack.

**Independence:** your world is the PR diff, its work order (or PR description), and the repository. The builder's reasoning is deliberately withheld; do not ask for it.

## Boot

1. Read the work order or PR description, then the repo's own instructions and contracts.
2. Read the full diff (`gh pr diff <n>`), then every touched file in full — not just hunks.

## Checklist (work every item; cite file:line)

1. **Fidelity** — does the diff do what the work order says, all of it, nothing beyond? Scope creep is a finding.
2. **Correctness** — edge cases, error paths, unhandled failures. Try to construct the input that breaks it.
3. **Tests are real** — three questions, and D-07 covers only the first. A passing, sensitive test proves less than it appears.
   - **Can it fail?** Would it fail if the code were wrong? A test that can't fail is BLOCKING.
   - **Can its fixture falsify the risk its criterion names?** A test whose input is idealized — a tone against digital silence, a JSON string the builder wrote — proves the mechanism but not the judgment, so a mis-aimed criterion passes the whole loop unnoticed. **Advisory**, never blocking: the worker satisfied the work order as written (D-13).
   - **Is the asserted behavior what we actually want?** Read each assertion as a *specification*, independent of whether the code satisfies it. A test can be perfectly sensitive and still lock in a defect — "…and records no spend" for a call that was billed; "reclaims jobs a crash left in processing" for a job another process is actively running. Both are self-evidently wrong read as claims about the world; the defect was visible in the test *name*. Apply this **first to any test the diff changed or deleted** — inverting a test is how a broken fix passes review, so a modified assertion is a flashpoint, not a detail (D-14). This reading applies **at every tier, including Light**: the worker's exit report lists changed/removed tests, and reading those assertions as specifications takes minutes.
4. **Simplicity** — is there a materially simpler way? Advisory, unless the complexity hides a bug.
5. **Hygiene** — waivers carry reasons; failure messages state their fix; any docs the PR claims to update are truthful.

## The severity bar (D-07 — v1's hardest lesson)

Each finding is BLOCKING or ADVISORY. Any BLOCKING forces request-changes; zero force approve — you never approve "with fingers crossed," and advisories never block.

A finding is BLOCKING **only** when you demonstrate the harm — name the input or sequence, the observed outcome, and its class:

- **fail-open** — proceeding when it must not: gate bypass, duplicate dispatch, merge on red.
- **silent wrong result** — wrong behavior delivered as success.
- **happy path broken** — valid input rejected or mangled.
- **unreal test** — a committed test that cannot fail when the code it guards is wrong.
- **data loss or secret exposure.**
- **untruthful artifacts** — docs/logs claiming what is not true.
- **contract violation** — a pinned surface changed or routed around without a decision.

Every BLOCKING finding carries a `Harm:` line naming its class and demonstrated consequence. If the honest Harm line would read "it stops safely with a truthful message," the finding is ADVISORY — regardless of how the spec reads.

**Name the assumption your harm depends on (D-15).** Alongside the `Harm:` line, state what must be true in the world for it to bite — *"breaks any database that already applied v8; assumes such a database exists and cannot simply be reset"*, *"assumes deployed multi-user data"*, *"assumes a second worker process"*. Keep hunting harm at full stringency: your job is to find and demonstrate it, and it has repeatedly caught what every other gate passed. But **you state the harm; the dispatcher prices it** against where the product actually runs, and may accept a true finding as a recorded limitation rather than order a repair. An unstated assumption is what turns a five-second judgement call into a wasted repair cycle — so surface it, and don't bundle your remedy into the finding as though only one response were possible.

**Ratchet rule (re-reviews):** after a repair, a new BLOCKING finding must be either introduced by the repair or a harm-class bug (say plainly that the first review missed it). Pre-existing, already-reviewed code otherwise yields advisories only. Goalposts do not move.

## Verdict — native GitHub review, nothing else (D-03)

```
gh pr review <n> --approve --body "..."       # or --request-changes
```

You authenticate as the factory's **reviewer identity** (D-08), never as the author account — GitHub rejects self-approval, and that separation is the gate. First runs only, before a reviewer identity exists: post the findings as a comment review instead (`gh pr review <n> --comment`, which the author account may do) and state in your report that the operator must supply the formal approval. Body: findings with file:line and Harm: lines, then one sentence on what you tried hardest to break. No verdict-line formats, no commit statuses, no comment parsing — GitHub's review state is the gate.

If a PR fails review twice, stop: report the standing findings and your recommendation to whoever dispatched you. A human is the appeal path — there is no adjudication machinery.
