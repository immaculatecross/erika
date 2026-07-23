# WO-platform-boundary — Platform boundary & resumable upload (E-24)

Target repo: immaculatecross/erika · Branch: `feat/platform-boundary` · **Review tier: Full**
<!-- Full is mandatory here: this touches an EXTERNAL CONTRACT (the tus resumable-upload
     protocol) and the INGEST ENTRY PATH (a completed upload must finalize into the
     existing ingest pipeline exactly as the current streamed POST does). Do not lower it.
     No migration in this milestone. -->
<!-- Batch: solo -->

## Objective

Erika's first Learn-era milestone lays the platform seam the rest of v0.4–v1.0 builds on (D-17, D-25), with no change a user sees except more reliable uploads. When this is done: (1) the API conventions are written down in `docs/api.md` — every capability is a JSON `/api` route, one error envelope `{ error: { code, message } }`, a single-user principal stamped by a no-op auth middleware, additive-only with no version prefix until native ships; (2) a real Next.js middleware stamps that principal on every request and API routes read it through one helper (today it is always the same local user — the seam E-40 later makes real, genuinely no-op now); (3) `GET /api/letter` no longer writes — marking the letter viewed becomes an explicit `POST /api/letter/viewed`, closing E-18's recorded limitation; (4) audio uploads move to the **tus** resumable protocol so a dropped connection resumes instead of restarting a 2 GB day-dump, while the current streamed raw-body `POST /api/sessions` stays as a working fallback; a completed tus upload finalizes into the **exact same** probe → `createSession` → queued-ingest path the streamed POST uses; and partial/abandoned uploads are reclaimed under a stated garbage-collection policy.

## Acceptance criteria

1. **`docs/api.md` lands** and documents the D-25 boundary as the convention for all new work: JSON `/api/*` routes only; the `{ error: { code, message } }` envelope; the single-user principal and how a route reads it; additive-only evolution with a version prefix deferred to native; the tus upload protocol (endpoint, how the client is used, how completion finalizes, the partial-upload GC policy). It is a living convention doc, not a one-off. (No test binding is required — there is no schema/migration ritual for it — but it must be accurate to the code that ships in this PR.)
2. **No-op auth middleware stamps a single-user principal.** A Next.js `middleware.ts` (App-Router root convention) attaches a single-user principal to every request, and one server helper (e.g. `lib/auth/principal.ts` → `getPrincipal()`) is the single read point. It is genuinely no-op: it always resolves the same local principal, adds no auth check, blocks nothing. A test asserts the helper returns the stamped principal for an API request. Name the principal shape so E-40 can make it real without a rename.
3. **`GET /api/letter` performs no write; `POST /api/letter/viewed` records the viewed marker.** The GET route returns the letter and mutates nothing (assert: two GETs of an unviewed week leave the viewed marker unchanged). The new `POST /api/letter/viewed` (body names the week, or defaults to the latest week with findings) calls the existing `markLetterViewed` and is idempotent/forward-only (re-posting an older or equal week never regresses the marker). The letter screen (`app/letter/page.tsx`, the `fetch("/api/letter")` effect at ~line 54) issues the POST after it has shown the letter, so the Practice plan's `letterUnread` still flips exactly as before. A test covers: GET does not mark; POST marks; POST is forward-only.
4. **Uploads move to tus, streamed POST kept as fallback.** A `@tus/server` catch-all route (e.g. `app/api/upload/[[...tus]]/route.ts`) handles the tus protocol against a file store under `data/` (gitignored). `lib/upload-audio.ts` uses `tus-js-client` as the primary path and keeps the existing raw-body `POST /api/sessions` streamed upload as an automatic fallback (both the file picker and mic recorder still funnel through `uploadAudio`, so the one-contract property holds). This is an external protocol contract — handle it defensively; a failed/aborted tus upload surfaces a truthful message and never leaves a half-session.
5. **A completed tus upload finalizes identically to the streamed path.** Extract the post-bytes-on-disk finalize logic from `app/api/sessions/route.ts` (format check → `probeDurationSeconds` → over-cap rejection → `createSession`, which inserts the `queued` `ingest_jobs` row at `lib/sessions.ts:72`) into one shared function, and call it from BOTH the streamed POST and the tus completion hook (`onUploadFinish`). A test proves a completed tus upload yields exactly one session row with exactly one `queued` ingest job and the correct probed duration/format — the same observable end state as a streamed upload of the same bytes. Over-cap and unsupported-format inputs are rejected on the tus path too, leaving neither file nor row (mirror the streamed path's cleanup).
6. **Partial uploads expire under a stated policy.** Incomplete tus uploads are reclaimed by a documented GC policy (state the TTL and the trigger — e.g. a startup sweep and/or the tus expiration extension; the disposable-`data/` rule applies). A test exercises the sweep: an expired partial upload's artifacts are removed; a fresh in-progress one is retained. State the policy in `docs/api.md` (criterion 1).

## Files and constraints

- **New:** `docs/api.md`; `middleware.ts`; `lib/auth/principal.ts` (or similar single read point); `app/api/upload/[[...tus]]/route.ts`; `app/api/letter/viewed/route.ts`; a shared upload-finalize module (e.g. `lib/finalize-upload.ts`).
- **Changed:** `lib/upload-audio.ts` (tus primary + streamed fallback), `app/api/sessions/route.ts` (call the shared finalize), `app/api/letter/route.ts` (remove the write), `app/letter/page.tsx` (POST viewed after render). `package.json` gains `@tus/server` and `tus-js-client`.
- **Contracts that must not break:** `uploadAudio(filename, body)` stays the single client entry for both upload sources; the streamed raw-body `POST /api/sessions` contract (x-filename header, streamed to disk, never multipart) keeps working as the fallback; `createSession` remains the one place a session + its queued ingest job are created; DESIGN.md holds for any visible copy (quiet, exact, sentence case).
- **Error envelope:** new and changed routes in THIS PR emit `{ error: { code, message } }`. Do **not** mass-migrate the ~30 existing routes to the new envelope — repo-wide error-envelope unification is explicitly milestone **E-39**, not this one.
- **DB/audio under `data/`** (gitignored); never commit anything under `data/` or `.env*`. Source files stay under 500 lines (pre-commit hook). Conventional Commits on every first line (commit-msg hook). Hooks are armed via `git config core.hooksPath .mfactory/hooks`.
- No `.env.local` / `OPENAI_API_KEY` is needed — this milestone makes zero model calls.

## Out of scope

- Real authentication, OAuth, sessions, or any principal that is not the single local user (that is E-40; here the middleware is deliberately no-op).
- Repo-wide error-envelope unification across existing routes (E-39).
- Any knowledge-model, FSRS, lexicon, cascade, or richness-dial work (E-25…E-28).
- A version prefix on the API (`/api/v1`) — additive-only until native ships (D-25).
- Migrating other client fetches or adding new product surfaces/nav. No schema migration — if you find yourself writing one, stop and report `blocked`.
- Litestream/hosting (E-40) and native/TUSKit (E-41).

## Exit report
<!-- Append here per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands) /
     Tests changed-removed / Risks / Blocker. Verify against DISPOSABLE state only — a
     throwaway data dir, never the product's default data/erika.db. Run lint + typecheck +
     test + build before pushing; the full `npm run build`, not typecheck alone. -->

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/38 (branch feat/platform-boundary)
Changed:
  - docs/api.md: new living D-25 boundary convention doc (JSON /api routes, error envelope, principal, additive-only/no version prefix, tus protocol + GC policy).
  - middleware.ts + lib/auth/principal.ts: no-op middleware stamps a single-user principal ({ id, kind: "local" }); getPrincipal(request) is the one read point (E-40 makes it real).
  - lib/api/error.ts: apiError(code, message, status) → { error: { code, message } } envelope.
  - app/api/letter/route.ts: GET no longer writes (removed markLetterViewed).
  - app/api/letter/viewed/route.ts: new forward-only POST that records the viewed marker (names the week, or defaults to the latest week with findings).
  - app/letter/page.tsx: fires POST /api/letter/viewed after the letter renders.
  - lib/finalize-upload.ts: shared finalizeStagedUpload (format check → probe → duration-cap → createSession); UploadRejected carries code/status.
  - lib/tus-server.ts: lazy @tus/server Server + FileStore under data/uploads/; onUploadFinish finalizes through the shared module; sweepExpiredUploads() GC; principal attributed on onUploadCreate.
  - app/api/upload/[[...tus]]/route.ts: catch-all delegating every method to the tus Server.
  - app/api/sessions/route.ts: streamed POST now calls the shared finalize and emits the { error: { code, message } } envelope; stays the fallback path.
  - lib/upload-audio.ts: uploadAudio uses tus-js-client primary + streamed POST automatic fallback; definitive file rejections surfaced, not retried.
  - package.json/package-lock.json: + @tus/server, @tus/file-store, tus-js-client.
Verified:
  - npm run lint → no ESLint warnings or errors.
  - npm run typecheck → clean.
  - npm run test → 450 passed / 66 files (22 new: principal, letter-viewed-route, upload-tus, upload-audio).
  - npm run build → compiled successfully; middleware + /api/letter/viewed + /api/upload/[[...tus]] in the route manifest.
  - upload-tus.test.ts drives the real tus protocol against Server.handleWeb (creation POST → PATCH, single- and two-chunk resume) with real ffprobe, proving finalize parity with the streamed path, rejection cleanup (413/415/422 leave neither file nor row), and the GC sweep (expired partial reclaimed, fresh retained). All against a throwaway ERIKA_DATA_DIR — never data/erika.db.
Tests changed/removed:
  - tests/honest-home-routes.test.ts: the "letter carries unread until GET serves it" case encoded E-18's read-that-wrote contract that this milestone closes. Updated to the new split — a GET leaves letterUnread true; the explicit POST /api/letter/viewed flips it. No test was weakened or deleted.
Risks:
  - tus Server/FileStore are lazy singletons reading maxUploadBytes() and TUS_UPLOAD_TTL_MS at first construction (like getDb); changing those envs after boot needs a restart.
  - The GC sweep runs on first tus-server construction, not on a timer; a process that never receives an upload never sweeps. Stated as the policy; a scheduled sweep is an E-40 concern.
  - onUploadFinish copies the completed tus file into the session dir before probing (bounded by the byte cap) rather than renaming in place, to keep tus-artifact cleanup uniform.
Blocker:  none
