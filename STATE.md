# State

> Boot sector: first read of every fresh session. Regenerated when things change — keep it one screen.

Erika founded 2026-07-17 via mfactory ideate. **Master the language you already speak**: a coach for people past fluency, built on their own recorded speech (PRODUCT.md). Apple-grade design, monochrome-plus-signal palette (accent black/white; green and red only where a state carries meaning — D-14). Stack: Next.js App Router (TypeScript strict) + Tailwind tokens + better-sqlite3; system `ffmpeg`/`ffprobe`; secrets only in `.env.local`; DB and audio under `data/` (gitignored). Hooks armed via `git config core.hooksPath .mfactory/hooks`. Gates lint/typecheck/test/build + tripwires run in CI on every PR, and `gates` **is** a required status check on `master` (branch protection: PRs required, linear history, zero required approvals — the factory merges on the reviewer session's verdict, D-11).

**Two processes, always.** `npm run dev` serves the UI and only *enqueues*; `npm run worker` drains ingest and analysis. Without the worker nothing is processed — and since v0.7 the product says so on first paint rather than leaving you to wonder.

**Shipped through v0.7.** Capture→ingest→analysis without buttons, native-audio tutor, one linear daily session, one answerable lesson format, forced onboarding and a real progress surface. Cold-start gate **PASSED** on 2026-07-26. Migrations through **v30** at the v0.7 close; decisions through D-28 there.

**v0.8 OPEN — Italian teaching, then the tutor lab.** **E-47 done (#94, v31, D-29):** every learner-visible lesson field is Italian; one-lesson-ahead prep; Start pins the servable body; opening/reopening and lesson GET are model-free and spend-free. **E-48 done (#95, D-30):** Conversation is a Speak→Done research lab — Native Realtime 2.1 vs STT→Terra across five prompt presets, shared TTS and turn contract, per-leg spend on the shared cap; spike 8 recorded without crowning a winner; Native + Current remains default. Realtime finalize floors at `max(minuteFloor, clientUsage)` so a client `0` cannot fail the monthly cap open. Migrations still **v31**; decisions through **D-30**. **~1549 tests** at the E-48 merge.

**Still owed in v0.8.** **E-39** leftovers + speaker predicate; **E-40** hosted; **E-41** native iOS. From the v0.7 close: cheap maintained driving harness + e2e in CI; cost optimisation as its own mission; close-sweep polish; key rotation; real accented speech through the voice-drill path. E-48 left standing advisories: concurrent transcript duplicate may refuse with a budget 402 instead of `duplicate_turn`; End is disabled while a turn is recording/processing.

**What E-48 taught (full record: `.mfactory/runs/RUN-009-tutor-model-prompt-lab.md`).** Client-trusted usage that can be `0` is a monthly-cap fail-open unless the server keeps a minute floor. A Node-only hash helper imported beside a client-safe constant breaks the production build. Realtime can emit valid turn JSON wrapped as `({…})` — unwrap the measured quirk, do not loosen the schema. Synthetic TTS matrices prove plumbing; they do not pick the listening architecture for real learners.

**Operator note.** Parent checkout may still carry an unrelated local last-card guard in `components/session/drills-step.tsx`; E-47's branch change there was only served-item evidence attribution.
