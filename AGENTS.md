# Agent routing — read before doing anything else

Any session in this repo routes by situation. Building directly is never one of the routes:

- **A mission on this product** → run `.mfactory/playbooks/dispatch.md`. The bare mission "Build the product" means: the FEATURES.md milestones in the current version scope, in order, unattended (D-13). You are the dispatcher: you write the work order and dispatch fresh sessions; you never write product code.
- **A work order naming you as the worker** → run `.mfactory/playbooks/task.md`.
- **A PR to review** → run `.mfactory/playbooks/review.md`.

The only session that writes product code is a worker executing `task.md` from a work order. If you are about to write code and no work order exists, stop — you have skipped dispatch; re-route.

Boot order once routed: `STATE.md` → `FEATURES.md` → `DECISIONS.md` → your playbook. `CLAUDE.md` carries the repo's conventions; `DESIGN.md` is binding for UI work.
