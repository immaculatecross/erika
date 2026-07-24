# WO-tutor — E-34: the Realtime tutor (closes v0.5)

Target repo: immaculatecross/erika · Branch: `feat/tutor` · **Review tier: Full**
<!-- Full: the MOST EXPENSIVE money path (Realtime audio S2S — per-session estimate/lease/ledger/
     truthful cap refusal, never-waivable spend) + an EXTERNAL CONTRACT (WebRTC + server-minted
     ephemeral token; the real API key must never reach the browser — a secret-exposure class) +
     writes EVIDENCE via a tool call + record→ingest→analysis (the one findings truth, E-17). -->

## First action
Branch `feat/tutor` off latest `master`; empty commit + `git push -u origin feat/tutor` first. **`git add` your WO file (`.mfactory/work-orders/WO-tutor.md`) in your first real commit** so it lands in the PR.

## Boot
`STATE.md` → `FEATURES.md` (E-34 row) → `DECISIONS.md` (**D-19** evidence; **D-20/D-10** spend; **D-23** register; **D-24** the tutor surface is a quiet field of accent dots — no avatar/face/waveform theatrics; **D-25** API boundary) → `HANDOVER.md` → `CLAUDE.md` → `DESIGN.md` (binding) → `docs/schema.md` → `.mfactory/playbooks/task.md`. Read: the **E-19 profile** builder, **active slips** (`lib/slips.ts`), the **composer's today targets** (`lib/compose.ts`), the **E-33 register hook** (`lib/tutor/persona.ts`), the **money spine** (`reserveSpend`/finalize/lease/`rates.ts`/the cap), the **evidence door** (`lib/knowledge/evidence.ts`, validated ids), the **capture→ingest** path (`<Recorder>`, `createSession`), and `lib/findings-model.ts` (E-17).

## Model landscape — VALIDATED LIVE 2026-07-24 (operator directive: do not trust the training cutoff). Build to these:
- **Flagship (default): `gpt-realtime`** (current version **`gpt-realtime-2.1`**); **tier switch in Settings → `gpt-realtime-2.1-mini`** (cheaper). Pin the exact ids from the account's model list at real-run; the family + versions are confirmed. Legacy `gpt-4o-realtime-preview` = do not use.
- **Ephemeral token (server-minted): `POST https://api.openai.com/v1/realtime/client_secrets`** with the **real API key** (server-side ONLY) + a session config `{ "type":"realtime", "model":"gpt-realtime-2.1", "audio":{"output":{"voice":…}} }` → returns an **ephemeral client secret expiring ~60 s**. The **browser** uses ONLY that ephemeral secret over **WebRTC** (SDP offer/answer). The real key must NEVER reach the client (secret-exposure = never-waivable).
- **Pricing (rates.ts):** `gpt-realtime` ≈ **$32 / 1M audio input tokens** ($0.40/1M cached) + **$64 / 1M audio output tokens**; mini cheaper; text tokens separate. Derive a **per-minute estimate** from expected audio-token throughput.
- **Tool/function calling during the session** is supported → the `log_evidence` tool.
- **Sandbox reality:** there is **no `OPENAI_API_KEY`** here AND the egress proxy blocks `api.openai.com` (the cold-start walkthrough saw a 403 "host not in allowlist"). So **build-to-mock + fixture-test** every mechanic behind seams; the **live WebRTC call is an operator-gated follow-up** (needs a key AND the proxy to allowlist `api.openai.com`) — document it, do NOT fabricate a live call.

## Acceptance criteria
1. **Server-minted ephemeral token, key never in the browser (secret-exposure = never-waivable).** A server route mints the ephemeral client secret via `/v1/realtime/client_secrets` using the server-side key; the browser receives ONLY the short-lived ephemeral secret. A test proves the real key is never sent to / readable by the client and the mint route requires the server principal. The client connects over **WebRTC** with the ephemeral secret (build the SDP offer/answer + data channel handling behind a seam that is unit-tested; the live connection is the operator-gated smoke).
2. **Session instructions built from the learner (D-23 register).** Instructions assembled from the **E-19 profile + active slips + today's composer targets + the E-33 register dial** (via `lib/tutor/persona.ts`). A fixture asserts the instruction payload contains the profile L1, the slip targets, today's items, and the register line. Default model `gpt-realtime-2.1`; **Settings tier switch** to `gpt-realtime-2.1-mini`.
3. **`log_evidence` tool → structured evidence (D-19).** Register a `log_evidence` function tool the model calls during the conversation to capture **errors and successes**; each call writes an `evidence` row through the E-25 append-only door on a **morph-it-validated lemma / valid rule id** (honest mode — cued/spontaneous as appropriate; an error is not drilled, D-18). Invalid ids are rejected, never minted. A test drives simulated tool-calls → correct evidence rows + derived-state rebuild.
4. **The call records client-side → lands as a normal session → ingest → deep analysis (E-17 one truth).** The conversation audio is recorded client-side and finalized through the **same `createSession`/ingest path** as any capture, so it is analyzed like any session and its findings are the one truth. A test asserts a completed tutor session creates a normal session + ingest job (no separate findings channel).
5. **Money: per-session estimate, lease, ledger, truthful cap refusal (never-waivable).** Before a call, show a **per-session estimate** (from the per-minute rate) and **reserve/lease** against the cap (an open realtime session holds a lease so a long call can't silently blow the cap — heartbeat/extend the lease, finalize to actual on end); **refuse truthfully at the cap** (no session opens). Reuse the existing reserve-before-call spine — do NOT fork a money path. `rates.ts` gains the realtime tier (audio in/out tokens). Tests: cap refuses with no token minted; a session finalizes to actual cost; the lease can't be overshot; cross-biller cap stays hard.
6. **The Learn home gains its tutor row (D-24).** A tutor entry on the Learn home; the tutor surface is **a quiet field of small accent-colored dots breathing with the voice — no avatar, no face, no waveform theatrics** (D-24), numbers as tabular numerals. DESIGN-faithful, Motion/Lucide.
7. **[RETRO-002 P5] Remove the dead Model-Tier control.** The vestigial `modelTier` Settings control (no behavior hangs off it — `lib/settings.ts`) is **removed** (the real tier switch now is the Realtime flagship/mini toggle this milestone adds). Don't leave two tier controls. A test/asserts the dead control is gone and the new realtime tier persists.
8. **Gates + ritual.** `lint`/`typecheck`/`test`/`build` + tripwires green; any new table → migration **v22** + `docs/schema.md` same PR; DESIGN + D-24 honored; **solo milestone — do the FEATURES/STATE ritual IN THIS PR** (E-34 → done, regenerate STATE; note **End of v0.5**). Document the operator-gated live smoke (key + proxy allowlist).

## Files and constraints
- New: the ephemeral-mint server route, the WebRTC client seam + tutor UI (dots field), `log_evidence` tool + evidence bridge, `rates.ts` realtime tier, the Learn tutor row; extend `lib/tutor/persona.ts`. Changed: Settings (realtime tier switch + remove dead modelTier), `rates.ts`, Learn home.
- Never-waivable invariants to reconfirm: **the real key never reaches the browser**; the cap is hard (lease-before-call, can't overshoot on a long session); one ledger row per finalized session; evidence append-only on validated ids; findings stay the one truth (E-17). Conventional Commits; hooks; 500-line/file; disposable state; never commit `data/`/`.env*`.

## Out of scope
- Pronunciation scoring (E-37/Azure), placement onboarding (E-35), speaker attribution (E-36), streak/map rendering (E-38). Do not build a second findings channel — the tutor session is a normal session.

## Exit report
Append to the WO per `task.md`: RESULT / PR / Changed / Verified (commands + the key-never-in-browser test + the log_evidence→evidence test + the record→ingest test + the money/lease/cap tests; note the operator-gated live WebRTC smoke) / Tests / Risks / Blocker.

---

## Exit report — 2026-07-24

RESULT: done
PR: feat/tutor → master (E-34, closes v0.5)
Changed:
- `lib/analysis/rates.ts` — realtime tier: `gpt-realtime-2.1` (flagship) / `-mini`, per-token audio in/out/cached rates, documented per-minute throughput knob, `realtimePerMinuteUsd`/`realtimeSessionCost`; `RealtimeModelId` added to `BillableModelId`.
- `lib/tutor/money.ts` — per-session estimate + lease on the ONE reserve-before-call spine (no forked money path): `openTutorLease`/`ensureTutorLeaseCovers` (heartbeat)/`finalizeTutorLease` (one committed row, clamped to reserved)/`releaseTutorLease`; lease = `pending` rows keyed `content_hash='tutor:<id>'`, swept by the existing `sweepStaleReservations`. NO new table/migration.
- `lib/tutor/mint.ts` — the ephemeral-mint seam (`POST /v1/realtime/client_secrets` with the real key server-side; returns only the ephemeral secret; `MinterUnavailableError` with no key).
- `lib/tutor/persona.ts` — grown from the E-33 hook to the full instruction (profile L1 + slips + today targets + register + the `log_evidence` contract, D-18).
- `lib/tutor/session-config.ts` — DB glue: collects profile/slips/composer-targets through the canonical readers, builds the persona, ships the Realtime session config + the `log_evidence` function tool.
- `lib/tutor/log-evidence.ts` — the `log_evidence` → evidence bridge: validates ids (morph-it lemma / seeded rule), rejects invalid (never mints), writes append-only through the E-25 door (source `tutor`).
- `lib/tutor/realtime-client.ts` — the WebRTC client seam (SDP offer/answer + data-channel + log_evidence dispatch), injectable/unit-tested; the browser uses ONLY the ephemeral secret.
- Routes: `app/api/tutor/session` (GET estimate, POST open+mint), `.../session/[id]/heartbeat`, `.../session/[id]/end`, `app/api/tutor/evidence`.
- UI: `components/tutor/dots-field.tsx` (D-24 dots, no avatar/waveform), `app/practice/tutor/page.tsx` (estimate → connect → record via `uploadAudio` → end), Learn home tutor row (`app/practice/page.tsx`).
- `lib/settings.ts` + `app/settings/page.tsx` — removed the dead `modelTier` control [RETRO-002 P5]; added the `realtimeTier` flagship/mini switch (default flagship).
- Docs/ritual: `docs/api.md` tutor section; `docs/schema.md` spend_ledger note (no migration); FEATURES E-34 → done; STATE regenerated (End of v0.5).
Verified (exact commands):
- `npx vitest run` → **708 passed** (100 files), up from 672. New: `tutor-money` (estimate/lease/heartbeat/finalize-clamp/release/cross-biller-cap/sweep), `tutor-persona` (payload has L1 + slips + today items + register + log_evidence), `tutor-evidence` (validated-id writes + reject unattested lemma/unknown rule + derived rebuild), `tutor-mint-route` (**the real key never appears in the client response** while it authorizes the mint server-side; 402 cap refusal mints no token; 503 with no key mints nothing), `tutor-record-ingest` (a tutor take lands as a normal session + queued ingest job; the end route writes no findings/evidence), `tutor-realtime-client` (handshake + log_evidence dispatch with the ephemeral secret), `tutor-dots-render` (dots only, no avatar/waveform).
- `npm run lint` clean · `npm run typecheck` clean · `npm run build` OK (`/practice/tutor` + `/api/tutor/*` in the bundle).
Tests changed/removed: `tests/settings.test.ts` — dropped the `modelTier` assertions (the control was removed, RETRO-002 P5), added `realtimeTier` persistence + a "modelTier is gone" assertion. `tests/register.test.ts` — the E-33 persona-hook call now passes `nativeLanguage` (persona input grew). No test was weakened.
Risks:
- Realtime rates + per-minute token throughput are documented approximations (no live key; T1 owed) — the cap guards the *modeled* budget, hard; pin the exact model ids/prices/voice against the account model list at real-run.
- The live WebRTC call is unexercised here (no key AND the proxy blocks `api.openai.com`) — operator-gated smoke, documented in `docs/api.md`. Everything else is mock/fixture-tested behind seams.
Blocker: none.
