# Playbook: errand — the light lane

A bounded standalone task handed directly by the operator — PR triage, a review pass, a diagnosis, a question, docs or config, a small fix on a Light/None surface. One session. No work order, no dispatcher, no fresh-session review. What replaces the ceremony is intelligence, real verification, and the platform gates — never nothing.

**An errand is never a unit of mission work.** If you are inside a mission — a work order exists, a dispatcher is running, or the task is a FEATURES.md milestone — this playbook does not apply to you; the mission's cheap path is a Light or None review tier, not this lane. Re-route.

## Routing — all three, or hand it to `dispatch.md`

- Fits one session.
- Adds no product scope: no new FEATURES.md milestone, no charter change.
- Touches no Full-tier surface (the D-16 list in `dispatch.md` step 6: money/billing, migrations/schema, data deletion, secrets, concurrency/leases, the ingest/analysis correctness path, any external contract).

If any test turns false mid-errand, stop, report what you found so far, and re-route. Raise, never lower.

## Intelligence over process

Run the errand on the most capable model available; if this session is not that model, spawn ONE fresh subagent on it and hand the errand over whole — never split an errand across agents. Set reasoning effort to the **second-highest tier the harness offers** (e.g. `xhigh` where it exists, else `high`) — deliberately not the maximum. Strongest per provider, as of 2026-07 (verify against provider docs if this table smells stale):

| Provider | Strongest |
|---|---|
| Anthropic | Fable 5 (`claude-fable-5`); else Opus 4.8 |
| OpenAI | the newest GPT-5-series reasoning model |
| Google | the newest Gemini Pro/Ultra reasoning model |

## Execute

1. Boot from files when a repo is involved: `STATE.md` if present, then only what the errand names.
2. Do the work. Judge by facts, not reports — CI state, the actual diff, the running thing — the dispatcher's discipline at every size.
3. Verify for real, at errand scale: exercise the outcome — run the command, hit the route, open the PR checks. `task.md`'s rules apply at every size: disposable state; full build when code changed.
4. Anything that commits rides the full deterministic layer: hooks, branch, PR, gates, branch protection. The light lane removes agent ceremony, never platform gates.
5. **The check.** When the result matters — it commits code, has an external side effect, or is a verdict the operator will act on — spawn one fresh-context subagent to fact-check the *outcome* ("does this conclusion hold?" / "does this actually run?"), not to re-review the work. Minutes, not a session. Pure read/answer errands skip it.

## Exit report — on the channel the errand arrived on

`task.md`'s format: RESULT / Changed / Verified / Risks. One LOG line in the target repo only if something was learned. Faithful over flattering, at any size: a truthful "couldn't verify" beats a confident answer.
