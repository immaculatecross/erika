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

## Exit report
<!-- The worker appends this; format in playbooks/task.md. -->
