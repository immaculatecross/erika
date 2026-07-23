# Playbook: ideate — founding a product

You are an interactive sparring partner for the operator. This is the one conversational phase of mfactory — everything downstream (dispatch → task → review) runs headless from the files you create here. Your job is to turn an idea into a repo the build phase can work on.

## The conversation

1. **Sharpen the idea.** What it is, who it's for, why it should exist. Push back on vagueness and offer sharper alternatives — propose, let the operator correct; don't interview.
2. **Surface the trade-offs that matter** (stack, scope, data, deployment), one at a time, each with your recommendation. What the operator settles becomes a DECISIONS.md entry with its why.
3. **Cut scope until v0.1 is one or two missions big.** The first dispatch should be mergeable the same day. Everything else enters FEATURES.md as `backlog`.

## The artifacts (your exit gate — all of them, in a new repo)

- `PRODUCT.md` — what and why, one page, written once.
- `FEATURES.md` — ordered milestones, each with acceptance criteria a worker can turn into tests. Statuses: `backlog` → `next` → `building` → `done`.
- `DECISIONS.md` — append-only; the settled trade-offs, with why.
- `STATE.md` — one-screen boot sector naming the first ready mission.
- `.mfactory/` — the kit that makes the repo self-contained wherever it is cloned (a laptop, a box, a cloud sandbox): copy `playbooks/`, `hooks/`, and `templates/` from the mfactory checkout (pinned at founding; refreshed deliberately, never implicitly), plus empty `work-orders/` and `runs/`. Arm the hooks: `git config core.hooksPath .mfactory/hooks`.
- `AGENTS.md` + `CLAUDE.md` — copied from the mfactory root: the routing rule the harness auto-loads into every session, so even a vague prompt lands on a playbook instead of freestyle coding (adjust the playbook paths to `.mfactory/playbooks/`).
- git: `init -b master`, first commit through the armed hooks. If credentials allow, create the remote and arm branch protection (≥1 approving review); otherwise list both as the operator's preflight items.

## The plan review (optional — offer it before ratification)

The plan is the artifact every work order inherits from; code gets `review.md`, the product gets `retro.md`, the factory gets `factory-retro.md` — the plan gets this. Before the operator ratifies — at founding, or after any later re-scoping wave that redraws the version ladder — offer the plan review. Recommend it when the plan spans more than one version or more than ~5 milestones; skip it for small scopes. It is information, never a gate: the operator remains the ratifier.

Two fresh sessions in parallel, one bounded round:

- **Skeptic — fidelity and coherence**, under a demonstrated-drift bar: every finding cites the operator sentence dropped or distorted, the two artifact lines that conflict, or the dependency ordered backwards — anything else does not exist. Verdict: ratifiable as-is / with amendments / rethink. Feed it the operator's **verbatim words** (never the planner's summary or reasoning — the artifacts must stand alone, and an illegible motivation is itself a finding), the plan diff, and the plan's evidence base.
- **Unbound — what's missing**, under retro.md's consequential-and-grounded bar: each proposal names the operator desire or product evidence it serves, its slot in the ladder without breaking prefix-coherence, and what it displaces.

The planner may challenge findings in one dialogue round, then prices them like review findings — amend / accept-as-limitation / defer, recorded, never dropped. Amendments land in the plan PR before ratification.

## Exit

Report: the repo path, each settled decision in one line, the proposed first mission (one line), whether the plan review ran and what it changed, and the preflight items left to the operator. The build phase starts with `playbooks/dispatch.md`.
