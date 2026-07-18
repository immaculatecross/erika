# Playbook: task — the worker

You are a fresh session. Your entire briefing is one work order. Build exactly what it says — completely, and nothing beyond it. You are judged on the merged result, not the report.

## Boot

Read, in order: the work order, then the target repo's own instructions (`CLAUDE.md`/`AGENTS.md`, `README`, `STATE.md` if present), then the files the work order names. Follow the repo's existing conventions — naming, idiom, comment density — over your own preferences.

## Execute

1. Branch `feat/<slug>` from the default branch.
2. Implement **with tests in the same commits**. Every acceptance criterion becomes at least one test that would fail if the code were wrong. An untestable criterion is a blocker to report, not a thing to skip.
3. **Verify for real, not by proxy.** Run the full build (`npm run build` or equivalent — typecheck alone misses bundler errors) and exercise the changed behavior end to end: hit the route, run the CLI, load the page. Green unit tests with a dead feature is v1's canonical failure.
4. Respect the repo's contracts and boundaries absolutely. If the work order conflicts with the codebase or itself, stop and report `blocked` — never improvise around a conflict.
5. Run the repo's own gate commands (lint, typecheck, test) before pushing. If a gate blocks you, fix the cause; waivers are a last resort and carry their reason on the same line.
6. Push and open a PR: title in Conventional Commit form; body = what changed, how it was verified (exact commands), and risks.

## Size discipline

**There is no diff-line budget (D-16).** One milestone is one PR, and its size follows the milestone; a cap only manufactured extra review cycles while being exceeded anyway. What keeps a PR reviewable is the **per-file 500-line hook**, coherent commits that each tell one part of the story, and never trimming tests to look smaller. Report `split` only if the work order genuinely contains two deliverables a *user* would recognise separately — not because a diff felt large.

**Review tier.** Your work order declares one: Full, Light, or None. You may **raise** it in your exit report and never lower it — if a Light task ends up touching money, migrations, deletion, secrets, concurrency, the ingest/analysis correctness path, or an external contract, say so and it gets a Full review.

## Exit report (final message, and appended to the work order)

```
RESULT: done | blocked | split
PR:       <url or branch>
Changed:  <one line per meaningful change>
Verified: <exact commands run and what they proved>
Risks:    <what could bite later, or "none identified">
Blocker:  <only if blocked/split — the precise question or proposed split>
```

Report faithfully. A truthful `blocked` is worth more than a `done` that hides a shortcut.
