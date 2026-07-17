# WO-capture-upload — E-2 Capture (part 1 of 2): upload, storage, sessions & player

Target repo: github.com/immaculatecross/erika · Branch: `feat/capture-upload` · Diff cap: ~400 lines (excl. lockfile; report `split` if it genuinely can't fit)

**Milestone context.** This is **part 1 of 2** of milestone E-2 (Capture). This part builds the ingestion backbone: upload an audio file → stream to disk → probe → it becomes a session you can list, play, and delete, with an ingest-job row showing its state. **Part 2 (WO-capture-mic, a separate later PR) adds mic recording** that posts to the very endpoint you build here. So build the upload path to be the single ingestion entry point both file-upload and (later) mic-capture funnel through. Do **not** build any mic/recording UI in this PR.

## Objective

From the Sessions screen a user uploads an audio file (mp3, wav, m4a, webm, ogg, aac, flac) up to 24 h / 2 GB. The request body is **streamed to disk, never buffered in memory**, landing under `data/sessions/<id>/`. Duration is probed with the system `ffprobe`; a file over 24 h or 2 GB is rejected with a truthful message and leaves no orphaned row or file. The session then appears in the Sessions list (the empty state gives way to the list), a detail page plays it with working seek, and an ingest-job row shows a `queued` state. Deleting a session removes its rows and its files from disk.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Streamed upload, never buffered.** `POST /api/sessions` (Node runtime — `export const runtime = "nodejs"`) streams the request body to `data/sessions/<id>/source.<ext>` using Node streams; the whole file is never held in memory. Enforce a byte cap **while streaming** via a `MAX_UPLOAD_BYTES` constant (default 2 GB) overridable by env for tests: exceeding it aborts mid-stream, deletes the partial file, and returns a truthful 413. (Test: with a tiny cap, an over-cap upload is rejected and no file/row remains; an under-cap upload lands the exact bytes on disk.)
2. **Format validation.** Only the seven formats are accepted (validate the extension/content-type; the ffprobe step confirms it is really decodable audio). An unsupported or undecodable file is rejected with a truthful message and creates no session row and no leftover file. (Test: a `.txt` and a corrupt file are both rejected cleanly.)
3. **ffprobe duration + 24 h cap.** After bytes land, duration comes from system `ffprobe` (D-7; shell out, handle its absence/failure truthfully). Sessions persist `duration_seconds`, `size_bytes`, `format`, `original_filename`, `created_at`. A file whose probed duration exceeds 24 h is rejected with a truthful message and fully cleaned up (file + any row). (Test: a short fixture records a correct duration; an over-cap duration — inject via a low test cap — is rejected and cleaned up.)
4. **Sessions list.** `/` lists sessions newest-first with duration and created time in tabular numerals (DESIGN.md); with zero sessions the existing empty state shows. The Sessions screen has a primary "Upload audio" affordance (file picker) that performs the upload with a visible in-progress state. (Test: seed a session → it renders in the list; zero → empty state.)
5. **Detail + player with seek.** `/sessions/<id>` shows session metadata and an audio player that streams from `GET /api/sessions/[id]/audio` with **HTTP Range support** (206 partial responses) so seeking works on long files. (Test: a Range request returns 206 with the correct partial bytes and `Content-Range`; a full request returns 200.)
6. **Ingest-job rows with visible states.** Creating a session creates one `ingest_jobs` row in state `queued`. Define the state set `queued | processing | done | failed` (this PR only ever sets `queued`; E-3 drives the rest). The UI (list and/or detail) renders the job state with a DESIGN-compliant indicator — use the semantic tokens (green resolved, red failed), not inline hex. (Test: creating a session yields a `queued` job row; the state renders.)
7. **Delete.** Deleting a session (`DELETE /api/sessions/[id]`) removes its `sessions` and `ingest_jobs` rows **and** its `data/sessions/<id>/` directory, then the list updates. (Test: create → delete → both rows gone and the directory gone from disk.)

## Files and constraints

- **Persistence (extend, don't rewrite):** add **migration version 2** to `lib/migrations/index.ts` (append-only — never edit v1) creating `sessions` and `ingest_jobs` (FK `session_id`, `ON DELETE CASCADE` and delete files explicitly too). New data-layer modules mirroring `lib/settings.ts` style: `lib/sessions.ts` (create/list/get/delete, typed), ingest-job helpers, `lib/ffprobe.ts` (probe duration; typed error on failure), `lib/audio-storage.ts` (the `data/sessions/<id>/` path helpers — the home E-3 will add normalized/segment files to). DB stays server-only.
- **API routes:** `app/api/sessions/route.ts` (POST upload + GET list), `app/api/sessions/[id]/route.ts` (GET + DELETE), `app/api/sessions/[id]/audio/route.ts` (GET stream with Range). All Node runtime.
- **UI:** evolve `app/page.tsx` (Sessions: list ⇄ empty state + upload affordance); add `app/sessions/[id]/page.tsx` (detail + player). DESIGN.md binding — calm rows, one accent, tabular numerals, semantic tokens for job state; reuse the shared empty-state/components from E-1.
- **Streaming discipline:** the upload and audio routes must not read whole files into memory (`Readable.fromWeb`/`createWriteStream`/range reads). This is the single hardest correctness point — a buffered implementation fails criterion 1 even if it "works" on a small file.
- **Repo rules:** every source file < 500 lines; Conventional Commits; **never** commit anything under `data/`; hooks armed. Node 20, system ffmpeg/ffprobe present.

## Out of scope (do not touch)

- **Any mic/recording UI** (MediaRecorder, level meter, timer) — that is WO-capture-mic (part 2).
- The actual ingest **processing**: normalization, VAD, segmentation, dedup (E-3). Jobs stay `queued`; do not implement a processor.
- Any model/API/analysis or cost logic (E-4); flashcards (E-5); auth/hosting.
- Editing shipped migration v1 or the Settings surface.

## Milestone ritual (this PR)

E-2 is not complete until part 2 merges, so in this PR set **FEATURES.md E-2 `next → building`** (do not mark it `done`, do not touch E-3's status). Leave STATE.md accurate — a full STATE regen is the milestone-completion ritual and belongs to part 2; a one-line "E-2 in progress: upload backbone landed" note is fine but keep it truthful.

## PR description must state

What changed per area, the **exact commands** used to verify each criterion (including how you proved the upload is streamed, not buffered, and the Range behavior) and what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT:   done
PR:       https://github.com/immaculatecross/erika/pull/5  (branch feat/capture-upload)
Changed:  migration v2 (sessions, ingest_jobs); lib/sessions.ts + lib/session-types.ts (typed data layer, client-safe split); lib/ffprobe.ts (duration probe); lib/audio-storage.ts (data/sessions/<id>/ helpers + streamed streamToFile with mid-stream byte cap); lib/format.ts.
          API (Node runtime): app/api/sessions/route.ts (POST streamed upload + GET list), app/api/sessions/[id]/route.ts (GET + DELETE), app/api/sessions/[id]/audio/route.ts (GET + HTTP Range 206/200).
          UI: app/page.tsx (list <-> empty state + Upload affordance), app/sessions/[id]/page.tsx (detail + player + delete), components/job-state-badge.tsx (semantic tokens), components/empty-state.tsx (wired optional onAction).
          CI: .github/workflows/ci.yml installs ffmpeg so ffprobe tests run in `gates`. Ritual: FEATURES.md E-2 next->building; STATE.md progress note.
Verified: `npm run lint` clean; `npm run typecheck` clean; `npm run test` 26 pass (route handlers exercised against real fs + real ffprobe: exact-bytes landing, over-cap 413 + cleanup, .txt 415, corrupt 422, over-duration 413 + cleanup, list order, queued job, Range 206 w/ Content-Range + full 200, delete removes rows + dir); `npm run build` green.
          Live curl against `next dev` (MAX_UPLOAD_BYTES=1048576): under-cap mp3 landed exact 129192 bytes + duration 8.045714s/queued; 2MB-over-1MB-cap -> 413 no dir; .txt -> 415; corrupt.wav -> 422; Range bytes=0-99 -> 206 Content-Range bytes 0-99/129192 (100 bytes); full -> 200; DELETE -> dir gone, detail 404, list []. Screenshotted list + detail (DESIGN-compliant).
Risks:    PR product code ~840 lines (+~285 tests) over the ~400 soft target — the 7 criteria are one interdependent backbone; splitting would ship non-functional fragments and trimming tests is disallowed; every file stays <142 lines. Jobs stay `queued` (processor is E-3). Upload is raw streamed body + x-filename header (not multipart) to avoid buffering; mic capture (part 2) posts the same way.
Blocker:  none
```
