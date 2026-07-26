# State

> Boot sector: first read of every fresh session. Regenerated when things change — keep it one screen.

Erika founded 2026-07-17 via mfactory ideate. **Master the language you already speak**: a coach for people past fluency, built on their own recorded speech (PRODUCT.md). Apple-grade design, monochrome-plus-signal palette (accent black/white; green and red only where a state carries meaning — D-14). Stack: Next.js App Router (TypeScript strict) + Tailwind tokens + better-sqlite3; system `ffmpeg`/`ffprobe`; secrets only in `.env.local`; DB and audio under `data/` (gitignored). Hooks armed via `git config core.hooksPath .mfactory/hooks`. Gates lint/typecheck/test/build + tripwires run in CI on every PR, and `gates` **is** a required status check on `master` (branch protection: PRs required, linear history, zero required approvals — the factory merges on the reviewer session's verdict, D-11).

**Two processes, always.** `npm run dev` serves the UI and only *enqueues*; `npm run worker` drains ingest and analysis. Without the worker nothing is processed — and since v0.7 the product says so on first paint rather than leaving you to wonder.

**Shipped through v0.7.** Capture→ingest→analysis without buttons, native-audio tutor, one linear daily session, one answerable lesson format, forced onboarding and a real progress surface. Cold-start gate **PASSED** on 2026-07-26. Migrations through **v30** at the v0.7 close; decisions through D-28 there.

**v0.8 OPEN — Italian teaching first.** **E-47 done (#94, v31, D-29):** lesson chrome stays English, but every learner-visible lesson field is Italian. The 266-rule syllabus is authored in Italian; generated bodies are language-gated and cached as contract v2; the composer-selected lesson is prepared one ahead; Start pins the body it promises so a late healthy preparation cannot swap the open session; opening/reopening and lesson GET are model-free and spend-free; keyless/cap/network failure falls back to authored Italian, and vocabulary-only offline days substitute a complete grammar lesson at the CEFR edge. Ambiguous model timeouts commit the reserved upper bound once rather than understating spend. **1523 tests** at merge.

**Still owed in v0.8.** **E-39** leftovers + speaker predicate; **E-40** hosted; **E-41** native iOS. From the v0.7 close: cheap maintained driving harness + e2e in CI; cost optimisation as its own mission; close-sweep polish; key rotation; real accented speech through the voice-drill path.

**What E-47 taught (full record: `.mfactory/runs/RUN-008-italian-lessons-ahead.md`).** A green suite can still accept all-English teaching and wall a fresh onboarding path. Helper tests that never reach the planner/product boundary are fiction. Claim sweeps without ownership tokens and timeouts without observers invent money defects. Servability without pinning invents silent lesson swaps inside a frozen session. Mutation-insensitive repair tests are unreal tests.

**Operator note.** Parent checkout may still carry an unrelated local last-card guard in `components/session/drills-step.tsx`; E-47's branch change there was only served-item evidence attribution.
