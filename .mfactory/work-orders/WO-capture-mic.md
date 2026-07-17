# WO-capture-mic — E-2 Capture (part 2 of 2): record from the mic

Target repo: github.com/immaculatecross/erika · Branch: `feat/capture-mic` · Diff cap: ~400 lines (excl. lockfile)

**Milestone context.** Part 2 of 2 of E-2 (Capture). Part 1 (the upload/storage/session/player/delete backbone) is **already merged on `master`** — reuse it. Mic recording produces an audio blob that posts to the **existing** ingestion endpoint; you should not need to change the server upload route. **This PR completes milestone E-2**, so it carries the completion ritual.

## The endpoint you post to (fixed contract, do not change)

`POST /api/sessions` with the **raw file bytes as the request body** and an `x-filename` header (e.g. `recording-2026-07-17T18-30-00.webm`) — NOT multipart FormData (the server streams the body to disk and never buffers). The extension in `x-filename` must be one of the supported formats (`mp3, wav, m4a, webm, ogg, aac, flac`); `MediaRecorder` on Chromium yields `audio/webm`, which is supported. On success the response is the new session; it then appears in the Sessions list with a `queued` ingest job (part-1 behavior — reuse it, don't reimplement).

## Objective

On the Sessions screen, next to the existing "Upload audio" affordance, a "Record" control captures live from the microphone: a **live level meter that responds to the voice** (DESIGN.md's signature "recording waveform breathing with your voice"), an **elapsed timer** in tabular numerals, and Stop. Recording uses a **chunked `MediaRecorder`** (a timeslice, so a long take is flushed in pieces and survives rather than riding on one fragile buffer). On Stop, the chunks assemble into a file and POST to the endpoint above; the new session lands in the list with a `queued` job. Denied mic permission is handled with a quiet, truthful message — never a dead button or a crash.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Record → session.** With mic access granted, pressing Record then Stop uploads the take to `POST /api/sessions` and the new session appears in the Sessions list with a `queued` job and a non-zero duration. (Test: Playwright with a fake audio device — `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream` — record ~2 s, stop, assert the list gains a session whose job badge is `queued`.)
2. **Chunked, long takes survive.** `MediaRecorder` is started with a timeslice so `dataavailable` fires periodically; the final file is the ordered assembly of all chunks and is complete/decodable across chunk boundaries (not truncated to the last chunk). (Test: unit-test the chunk-assembly helper — N chunks in → one Blob of the summed bytes in order; e2e take spanning multiple timeslices produces a playable file with the expected duration.)
3. **Live level meter.** The meter is driven by real input level via a Web Audio `AnalyserNode` on the mic stream (not a fake animation): silence reads low, sound reads higher. Transform/opacity only, spring motion per DESIGN.md. Under `prefers-reduced-motion: reduce` it degrades to a non-animated level indicator (no spring/transform motion). (Test: unit-test the level-from-analyser computation — a low-amplitude buffer yields a low level, a high-amplitude buffer a high level; a reduced-motion unit/e2e check that the animated variant is not used.)
4. **Elapsed timer.** A monotonic elapsed timer displays while recording, formatted `h:mm:ss`/`m:ss`, tabular numerals. (Test: unit-test the format helper across boundaries — 9 s, 65 s, 3661 s.)
5. **Permission denied is truthful.** If `getUserMedia` is denied or unavailable, the UI shows a quiet, specific message (DESIGN copy — no exclamation, no cheerleading) and no broken control; Upload still works. (Test: a unit/e2e check that a rejected `getUserMedia` renders the message and does not throw.)

## Files and constraints

- **Client component(s):** a recorder UI (e.g. `components/recorder.tsx`) plus a meter subcomponent if it helps stay under 500 lines; a client hook (e.g. `lib/use-recorder.ts`) wrapping `MediaRecorder` + `AnalyserNode`; pure client-safe helpers (e.g. `lib/recording.ts`) for elapsed formatting, level computation, chunk assembly, and picking a supported `MediaRecorder` mime + matching extension via `MediaRecorder.isTypeSupported`. Keep pure logic out of React so it's unit-testable.
- **Wire into** `app/page.tsx` (Sessions): add "Record" beside "Upload audio"; on success refresh the list the same way the upload flow does. Do not duplicate the upload/list/session logic — reuse part 1.
- **Do not change** the server upload route, migrations, or the audio/detail routes. If you believe a server change is truly required, stop and report `blocked` with the reason.
- **DESIGN.md is binding.** The level meter is a named signature moment — budget quality here (real-input-driven, spring, 60fps, reduced-motion degradation). Black/white accent, green/red only for meaningful state (D-14); a live "recording" indicator may use red as its meaning. System font, tabular numerals.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed. Note the existing `gates` CI check (lint+typecheck+test+build+tripwires) must pass.

## Out of scope (do not touch)

- Streaming/incremental upload *during* recording, pause/resume, waveform scrubbing of recorded audio — future, not E-2.
- Any ingest processing / VAD / normalization / analysis (E-3/E-4); flashcards (E-5); auth/hosting.
- The server upload/storage/detail routes and the migrations (part 1, fixed).

## Milestone ritual (this PR completes E-2)

Flip **FEATURES.md E-2 `building → done`** and **E-3 `backlog → next`**, and **regenerate STATE.md** (one screen) to reflect that Capture shipped (upload + mic, sessions listable/playable/deletable, jobs queued) and E-3 Smart ingest is next. Keep it truthful — the reviewer checks.

## PR description must state

What changed per area, the **exact commands** used to verify each criterion (including how you drove the fake-mic e2e and proved chunk assembly), what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/6
Changed:  lib/recording.ts — pure helpers: formatElapsed, levelFromAnalyser (RMS),
          assembleChunks, pickRecordingMime, encodeWav (16-bit WAV).
          lib/use-recorder.ts — MediaRecorder + AnalyserNode state machine; 1 s
          timeslices; on Stop assembles chunks and re-encodes to WAV.
          components/level-meter.tsx — signature meter (scaleY spring from real
          input; non-animated height readout under reduced motion).
          components/recorder.tsx — Record button, live panel (red dot, tabular
          timer, meter, Stop), quiet denied/unsupported message.
          lib/upload-audio.ts — one shared client path to POST /api/sessions.
          app/page.tsx / components/empty-state.tsx — Record wired beside Upload.
          FEATURES.md E-2 building→done, E-3 backlog→next; STATE.md regenerated.
          Server upload route, migrations, audio/detail routes: unchanged.
Verified: npm run test (41 unit incl. tests/recording.test.ts — criteria 2,3,4 +
          mime pick + WAV header); npm run typecheck; npm run lint; npm run build;
          .mfactory/hooks/run-tripwires.sh --all (exit 0) — all green.
          npx playwright test (Chromium fake audio device) — 11 green incl.
          e2e/recorder.spec.ts: Record ~2.6 s → Stop → session with a queued job
          and non-zero duration (criteria 1,2); reduced-motion meter variant
          (criterion 3); denied getUserMedia shows a truthful line, no crash,
          Upload still works (criterion 5).
Risks:    Diff (~520 src + ~230 test lines) exceeds the ~400 soft cap — the WAV
          normalization was unplanned (a live WebM/Opus stream has no container
          duration ffprobe can read, so the WO's "WebM just works" did not hold);
          one interdependent feature, so shipped whole rather than split. WAV is
          uncompressed — fine for short mic takes; day dumps arrive via Upload.
          decodeAudioData holds the take as PCM at Stop (bounded by take length).
Blocker:  none
```
