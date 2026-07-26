# WO-__SLUG__ — __TITLE__

Target repo: __REPO__ · Branch: `feat/__SLUG__` · **Review tier: Full | Light | None**
<!-- Tier (D-16), declared before work starts. FULL and never skippable when the work
     touches money/billing, migrations/schema, data deletion, secrets, concurrency or
     leases, the ingest/analysis correctness path, or an external contract. LIGHT for
     additive UI over an existing read-model, copy, styling, docs, tests. NONE (gates
     only) for changes with no product-behaviour surface. The worker may raise the tier,
     never lower it. No diff-line cap — size follows the milestone. -->
<!-- If this milestone is dispatched as part of a PARALLEL batch, say so here, and note
     that the dispatcher — not the worker — performs the FEATURES/STATE ritual. -->
<!-- Batch: solo | parallel with <other WOs> -->

## Objective
<!-- One paragraph: what exists when this is done, in behavior terms. -->

## Acceptance criteria
<!-- Numbered. Each becomes at least one test. Name observable outcomes
     (HTTP status, rendered page, CLI output) — not internal helpers.
     If a criterion pins a threshold/heuristic or parses another system's
     output, say so and choose (D-13): either one REAL, LABELLED sample as
     the oracle, or an explicit "uncalibrated" note plus truthful degradation
     — and for external output, isolation so one bad response can't fail the
     whole run. A synthetic fixture proves the mechanism, never the judgment. -->

## Files and constraints
<!-- The 3–5 files that matter; contracts or conventions that must not break; or "none". -->

## Out of scope
<!-- Explicitly named temptations. The worker must not touch these. -->

## Gates that will not tell you the truth locally

<!-- Two verification gaps cost CI round trips in RUN-007. They are properties of the
     tooling, not of any milestone, so they belong in every work order. -->

- **Run `.mfactory/hooks/run-tripwires.sh --all` before opening the PR.** The pre-commit
  hook runs `--staged` — fast by design, and it scans only what you staged in that
  commit. CI runs `--all`. A file that was clean when staged can turn CI red later, and
  did: a test fixture containing a string that matched the secret-scanner pattern.
- **`npm run lint` was a no-op inside a git worktree nested under the parent checkout**
  until `"root": true` landed in `.eslintrc.json` — ESLint walked up, hit a duplicate
  `@next/next` and aborted **before linting a single file**, so workers reported green
  while nothing was linted. That is fixed; if you ever see lint pass suspiciously fast
  or emit no file-level output, verify with `npx eslint . --ext .ts,.tsx` before
  believing it.

**The general rule these two are instances of: a gate that reports success without
having examined anything is worse than no gate.** If a check passes and you cannot say
what it looked at, it has not run.

## Exit report
<!-- The worker appends this; format in playbooks/task.md. -->
