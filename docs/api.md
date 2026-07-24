# The API boundary

> The D-25 platform seam, laid in E-24. This is a **living convention doc**: every
> new capability follows it, and it stays accurate to the code that ships. It is
> not a per-route reference — routes document themselves in their handlers.

Erika's server is a set of JSON HTTP routes under `app/api/`. Today they serve one
local user from one machine; the boundary is written so the hosted (E-40) and
native (E-41) eras extend it without rewriting callers.

## Conventions for all new work

- **JSON `/api/*` routes only.** A capability is a route under `app/api/`. It
  accepts and returns JSON (the one exception is binary media streaming, e.g.
  `/api/sessions/[id]/audio`, and the tus upload protocol below). No RPC grab-bag,
  no server actions for data mutation.
- **One error envelope.** An error is `{ error: { code, message } }` — a stable
  machine `code` and a quiet, exact human `message` (DESIGN copy rules: sentence
  case, specific, never cheerleading). Use the `apiError(code, message, status)`
  helper in `lib/api/error.ts`. Success bodies are the resource itself, no wrapper.
  - *Migration note:* the ~30 routes that predate E-24 still return
    `{ error: "string" }`. Unifying them is milestone **E-39**, not a rider on
    every feature. New and changed routes adopt the envelope as they are touched.
- **One principal, read in one place.** A no-op middleware (`middleware.ts`)
  stamps every request with a single-user principal; a route reads it through
  `getPrincipal(request)` in `lib/auth/principal.ts` and nowhere else. The
  principal shape is `{ id, kind: "local" }`. It gates nothing today — E-40
  fills `id` with a real user and widens `kind`. Write identity-dependent code
  against `getPrincipal`, never against an assumed local user.
- **Additive-only; no version prefix.** Routes evolve by addition — new routes,
  new optional fields — never by breaking an existing shape. There is deliberately
  **no `/api/v1` prefix**: a versioned surface waits until the native client ships
  and an external contract actually needs pinning (D-25). Until then, additive
  evolution keeps the single first-party client in lockstep.
- **Reads do not write.** A `GET` is safe and idempotent. Recording that
  something was seen is its own explicit `POST` (see the letter below).

## Uploading audio

Audio capture is day-scale — a single upload can be a multi-hour, multi-gigabyte
dump — so the upload path is built to survive a dropped connection.

### The one client entry

Both the file picker and the mic recorder call `uploadAudio(filename, body)` in
`lib/upload-audio.ts`. That is the only place the upload contract lives.

1. **Primary — tus resumable.** `uploadAudio` uploads via `tus-js-client` to
   `POST /api/upload`. A dropped connection resumes from its last acknowledged
   offset instead of restarting the whole file.
2. **Fallback — streamed POST.** If tus is unsupported in the browser, or its
   endpoint fails at the transport level, `uploadAudio` automatically falls back
   to the original streamed upload: `POST /api/sessions` with the raw file bytes
   as the body and an `x-filename` header (never multipart — the server streams
   straight to disk). A *definitive* rejection of the file itself (unsupported
   format, too large, undecodable, over the 24 h cap) is surfaced truthfully and
   **not** retried through the fallback.

### The tus endpoint

`app/api/upload/[[...tus]]/route.ts` is a catch-all that delegates every method to
a `@tus/server` `Server` (`lib/tus-server.ts`), mounted at `/api/upload`:

- The creation `POST /api/upload` (with `Upload-Length` and an `Upload-Metadata`
  `filename`) returns a per-upload URL `/api/upload/<id>`.
- `PATCH /api/upload/<id>` appends bytes at an `Upload-Offset`; `HEAD` reports the
  current offset so the client can resume; `DELETE` aborts.
- Partial uploads and their tus metadata live under `data/uploads/`
  (gitignored, `ERIKA_DATA_DIR`-rooted like the DB and session audio).

### Completion finalizes into the ingest pipeline

When an upload reaches its full length the server's `onUploadFinish` hook runs the
**shared** `finalizeStagedUpload` (`lib/finalize-upload.ts`) — the exact same
finalize the streamed `POST /api/sessions` uses:

> format check → `probeDurationSeconds` (the real decodability gate) →
> over-the-24 h-cap rejection → `createSession` (the single insert of a session
> row and its one `queued` `ingest_jobs` row).

So a completed tus upload and a streamed upload of the same bytes reach the
identical observable end state. On success the tus staging artifact is reclaimed
immediately. On rejection the session directory and the tus artifact are both
removed and a truthful non-2xx message is returned — never a half-session.

### Garbage collection of partial uploads

An **incomplete** upload (client abandoned it, or a resume never came) expires
`TUS_UPLOAD_TTL_MS` after it was created — **default 24 h**. The server advertises
the expiry via the tus expiration extension (`Upload-Expires`), and
`sweepExpiredUploads()` reclaims expired partials — deleting both the bytes and
the tus metadata — while leaving in-progress uploads and completed uploads
untouched. The sweep runs once when the tus server is first constructed (the first
upload request after a boot) and is safe to re-run. Completed uploads are not left
for the sweep; they are reclaimed the moment they finalize.

## The editor's letter (read/write split)

The weekly letter is the reference example of the reads-do-not-write rule:

- `GET /api/letter` (optionally `?week=YYYY-MM-DD`) returns the letter and mutates
  nothing. Two GETs of an unviewed week leave the viewed marker unchanged.
- `POST /api/letter/viewed` (body `{ "week": "YYYY-MM-DD" }`, or omit it to default
  to the latest week with findings) records the viewed marker via `markLetterViewed`.
  It is **forward-only**: re-posting an older or equal week never regresses the
  marker. The letter screen fires this after it has shown the letter, so the
  Practice plan's `letterUnread` flips exactly as before.

## The realtime tutor (E-34)

The spoken tutor is the most expensive money path AND an external contract, so its
routes carry two never-waivable classes — secret exposure and spend.

- `GET /api/tutor/session` — the pre-call estimate: the per-session cost, the
  month-to-date spend, the cap, the remaining budget, and the tier model. No side
  effects (a GET records nothing, D-25).
- `POST /api/tutor/session` — **open** a session. It reserves the estimate against
  the cap (`openTutorLease`, the ONE reserve-before-call spine — no forked money
  path) and, only if the cap admits it, mints a **short-lived ephemeral client
  secret** server-side (`POST https://api.openai.com/v1/realtime/client_secrets`,
  authorized by the real `OPENAI_API_KEY`). The response carries **only** the
  ephemeral secret + the session config (instructions, the `log_evidence` tool, the
  voice) the browser needs — **the real key never reaches the client**
  (secret-exposure, never-waivable). At the cap it returns `402` and mints nothing;
  with no server key it returns `503` and mints nothing.
- `POST /api/tutor/session/:id/heartbeat` (body `{ elapsedSeconds }`) — extend the
  lease so its reservation stays ahead of the call; a `402` means the cap cannot
  cover more and the client winds the call down. A long call can never silently
  overshoot the budget.
- `POST /api/tutor/session/:id/end` (body `{ elapsedSeconds }`) — finalize the lease
  to the **actual** elapsed cost, clamped to what was reserved (the lease can't be
  overshot): one committed ledger row per session. Money only — it writes no
  findings or evidence.
- `POST /api/tutor/evidence` (body `{ itemId, polarity, mode }`) — the `log_evidence`
  tool bridge. The browser forwards each tool call the model makes; the server writes
  one row to the append-only evidence log through the E-25 door on a **validated** id
  (morph-it-attested lemma / seeded rule). An invalid id is rejected (`400`), never
  minted.

The call **records client-side** and, on end, lands as a **normal session** through
the same `uploadAudio` → `finalizeStagedUpload` → ingest path as any capture, so its
findings are the one truth (E-17) — there is no separate tutor findings channel.

**The money lease reuses the ONE `spend_ledger`** (no new table): a session's
reservations are `pending` rows keyed by `content_hash = tutor:<id>`, reserved
through the shared `reserveSpend` (committed + pending ≤ cap, atomically), released
by the existing startup sweep if a client stops heart-beating.

**Operator-gated live smoke.** The live WebRTC call needs a configured
`OPENAI_API_KEY` AND the egress proxy to allowlist `api.openai.com` (blocked in the
build sandbox — a 403 host-not-allowlisted). Everything is built to mock + fixture
behind seams (`lib/tutor/mint.ts`, `lib/tutor/realtime-client.ts`); the real
end-to-end WebRTC conversation is an operator follow-up, documented, not faked.
