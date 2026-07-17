# State

> Boot sector: first read of every fresh session. Regenerated when things change — keep it one screen.

Erika founded 2026-07-17 via mfactory ideate. The repo is charter + kit only — no code yet. Charter: PRODUCT.md (what and why), DESIGN.md (binding rules for every UI diff), FEATURES.md (E-1…E-8, v0.1 = E-1…E-4 per D-5), DECISIONS.md (D-1…D-7). The mfactory kit is pinned in `.mfactory/` (playbooks, hooks, templates, empty work-orders/ and runs/); hooks are armed via `git config core.hooksPath .mfactory/hooks` — re-arm after any fresh clone. Secrets live only in `.env.local` (OPENAI_API_KEY, present, untracked); `gpt-audio-1.5` access was verified live at founding.

Next: **E-1 Foundation** (FEATURES.md). The dispatcher writes `.mfactory/work-orders/WO-foundation.md` and runs the loop in `.mfactory/playbooks/dispatch.md` — fresh worker session, fresh review session, merge through the gate. Operator-owned preflight: branch protection on master (private plan may refuse it; then the dispatcher merges only on an approving verdict), reviewer identity or the sanctioned comment-review fallback (mfactory D-08), and rotating the founding API key once v0.1 is verified (it transited a chat channel).
