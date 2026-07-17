# WO-ingest-pipeline — E-3 Smart ingest (part 1 of 2): the async speech-extraction pipeline

Target repo: github.com/immaculatecross/erika · Branch: `feat/ingest-pipeline` · Diff cap: ~400 lines soft (excl. lockfile & fixtures). If it genuinely can't fit, report `split` with the pre-identified fault line: **[worker engine + normalize + VAD + segments + resumable]** then **[content-hash dedup/cache + triage renditions]**.

**Milestone context.** Part 1 of 2 of E-3 (Smart ingest). This part is the **backend pipeline**: a queued capture is processed by an async worker into stored speech segments — normalized, silence-stripped, timestamped, deduplicated, and pre-rendered for the E-4 triage model — resumably and without exhausting memory on a day-long file. **Part 2 (WO-ingest-ui) is the UI** (raw-vs-speech time, segment timeline, live progress); do not build that UI here. This is the heart of Erika's cost architecture (D-10): nothing reaches a model until silence is gone and speech is segmented and cached.

## Objective

An async worker (`npm run worker`) drains `queued` ingest jobs. For each capture it: (1) normalizes the source to 16 kHz mono; (2) runs voice-activity detection to find the speech intervals and discard silence; (3) drops intervals under 2 s and stores each remaining segment with its **original-timeline timestamps**; (4) content-hashes each segment for dedup and caching so identical audio is never processed twice; (5) produces a configurable time-compressed (1.25–1.5×) triage rendition per segment for the later cascade. The job advances through visible states (`queued → processing → done`, or `failed` with a truthful error). The pipeline is **checkpointed**: a killed worker resumes the job where it stopped, never redoing finished work or duplicating segments. A day-long fixture completes with bounded memory (all audio work is ffmpeg file-to-file — never load a whole recording into Node memory).

## Pinned technical decisions (do not substitute without reporting `blocked`)

- **VAD = ffmpeg `silencedetect`** (energy-based): run it on the normalized audio, parse `silence_start`/`silence_end` from stderr, invert to speech intervals, merge intervals separated by a small gap (~300 ms), clamp to bounds. Dependency-free (system ffmpeg, D-7), deterministic, fixture-testable. A learned speech/noise model is an explicit **future** upgrade — say so in a comment; do not add a native/WASM VAD dependency here.
- **Worker model:** `scripts/worker.ts` (`npm run worker`) is a thin loop around a testable `processJob(db, jobId, opts?)` function. On start the worker first **reclaims** any job stuck in `processing` (crash recovery) and resumes it, then claims the oldest `queued` job via an atomic state transition. Tests call `processJob` directly on a fixture — the worker loop is not where the logic lives.
- **All audio ops are ffmpeg file→file** (`-i source … out`): normalize, per-interval segment extraction (`-ss/-to`), and `atempo` renditions. No `decodeAudioData`, no reading full files into Buffers. This is what makes day-scale memory-safe.
- **Rendition tempo** is configurable via a validated constant/env (`TRIAGE_TEMPO`, default `1.5`, allowed range `1.25`–`1.5`); reject out-of-range truthfully.
- **Content hash** = SHA-256 over the segment's normalized PCM bytes; it is the cache key. Renditions cache by hash under a shared `data/cache/` dir so a repeated segment (even across sessions) reuses the artifact.

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong. Use small synthesized ffmpeg fixtures (e.g. sine tones separated by `anullsrc` silence) committed under a test fixtures dir — never real audio, never anything in `data/`.

1. **Normalize.** The pipeline writes a 16 kHz mono normalized rendition of the source under the session dir. (Test: probe the output — sample_rate 16000, channels 1.)
2. **VAD extracts speech, discards silence.** On a fixture of `[2s tone][3s silence][4s tone]`, the pipeline yields exactly the two speech intervals with correct start/end (± a tolerance) in the **source timeline**, and the silence is absent. (Test: assert interval count and boundaries.)
3. **Sub-2 s dropped.** A `[1s tone][3s silence][5s tone]` fixture yields one segment (the 1 s is dropped). (Test: assert count and that the kept segment is the 5 s one.)
4. **Segments persisted with timestamps + hash.** Each kept segment is a row (migration v3 `segments` table: session FK cascade, ordered index, start_ms, end_ms, duration_ms, content_hash) with its extracted audio on disk. (Test: rows match intervals; hashes are stable and equal for identical audio.)
5. **Dedup / cache.** Two identical segments (same bytes, same session or across two sessions) share one content_hash and the rendition is computed once and reused — the second does not regenerate it. (Test: process the same fixture twice; assert the rendition file is not rewritten / a cache hit is recorded.)
6. **Triage renditions.** Each segment has a time-compressed rendition at the configured tempo, probeable and shorter than the segment by ~the tempo factor. (Test: rendition duration ≈ segment_duration / tempo; out-of-range tempo rejected.)
7. **Job lifecycle + truthful failure.** `processJob` moves the job `queued → processing → done`; a forced ffmpeg failure (e.g. a corrupt/mislabeled input) lands `failed` with a truthful error string and no half-written partial claimed as done. (Test: happy path reaches `done`; injected failure reaches `failed` with the message.)
8. **Resumable.** After the job is interrupted mid-pipeline (simulate: run to a checkpoint, then re-invoke `processJob`), it completes from where it stopped — finished stages are not redone and no segment is duplicated (idempotent per-segment/per-stage). (Test: checkpoint after normalize (and again after partial segmenting), resume, assert final segment set is correct and unduplicated, and that a completed stage's expensive step was skipped.)
9. **Memory-safe on a long input.** A multi-minute fixture of alternating tone/silence (long enough to be meaningful; document the length) processes to the correct segment count without loading the whole file into memory. (Test: process the long fixture and assert correctness; assert the design reads via ffmpeg file I/O — e.g. peak RSS stays bounded well under the file size, or assert no full-file Buffer read path exists.)

## Files and constraints

- **Migration v3** (append-only; never edit v1/v2): add the `segments` table and extend `ingest_jobs` with checkpoint columns — a fine-grained `stage` (e.g. `normalizing|detecting|segmenting|rendering|done`), a `progress` (0–1), an `error` text, and an `updated_at`. Keep the existing coarse `state` (queued/processing/done/failed) as the lifecycle the UI already reads.
- **New modules** (each < 500 lines, single-purpose), suggested: `lib/ingest/pipeline.ts` (`processJob` + stage orchestration/checkpointing), `lib/ingest/normalize.ts`, `lib/ingest/vad.ts` (silencedetect parse → intervals; pure interval math split out and unit-tested), `lib/ingest/render.ts` (atempo renditions + cache), `lib/segments.ts` (typed data layer, `lib/settings.ts` style), `lib/ingest/ffmpeg.ts` (spawn/collect helpers), `scripts/worker.ts`. Reuse `lib/audio-storage.ts` path helpers; add cache-dir helpers there.
- **Storage:** normalized + segment + rendition files live under `data/sessions/<id>/…` and `data/cache/…` (both gitignored). Deleting a session must still remove its files (extend the existing delete cleanup to cover the new files; shared cache entries keyed by hash are not deleted with one session — note this).
- **DESIGN/UI:** no new UI surfaces here. The existing job-state badge will now animate through real states — that's fine. Binding DESIGN rules still apply to any incidental copy.
- **Repo rules:** files < 500 lines; Conventional Commits; **never** commit anything under `data/`; hooks armed; the `gates` CI check (which installs ffmpeg) must pass. Keep the pipeline fast enough for CI (small fixtures) — the long fixture test may be marked slow but must still run in `gates`.

## Out of scope (do not touch)

- **The E-3b UI**: raw-vs-speech-time summary, segment timeline, per-segment playback, live progress display. Jobs advancing through states is enough here.
- **Any model/API call, triage, cost estimate, or analysis (E-4).** Renditions are produced and cached but **sent nowhere**.
- Flashcards (E-5); auth/hosting; the E-2 upload/capture surfaces and their contract.
- A learned/ML VAD; a Settings UI for tempo (env/constant is enough now).

## Milestone ritual (this PR)

E-3 completes in part 2, so set **FEATURES.md E-3 `next → building`** (not `done`; don't touch E-4). Leave STATE.md accurate; a full regen belongs to part 2. A one-line "E-3 in progress: ingest pipeline landed" note is fine if truthful.

## PR description must state

What changed per area; the **exact commands** proving each criterion — especially how you demonstrated (a) resumability without duplication and (b) memory-safety/file-based processing on the long fixture; and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

```
RESULT:  done
PR:      https://github.com/immaculatecross/erika/pull/7  (feat/ingest-pipeline)
Changed:
  - migration v3 (append-only): segments table + ingest_jobs checkpoint columns (stage/progress/error/updated_at)
  - lib/ingest/{ffmpeg,normalize,vad,render,pipeline}.ts: normalize 16kHz mono; silencedetect VAD (parse->invert->merge->drop sub-2s); segment extract + streamed SHA-256 + hash-keyed atempo renditions cached under data/cache/; processJob stage orchestration + checkpointing + claim/reclaim
  - lib/segments.ts: typed data layer (idempotent upsert by session+idx)
  - scripts/worker.ts + `npm run worker`: thin loop reclaims crashed processing jobs then drains queued
  - lib/audio-storage.ts: normalized/segment/cache path helpers; delete route note (session files removed, shared cache retained)
  - tests: fixtures.ts + ingest-vad/pipeline/worker tests (all 9 criteria)
  - FEATURES.md E-3 next->building; STATE.md pipeline note
Verified:
  - `npm run test` -> 62 passed (9 pipeline criteria vs synthesized ffmpeg fixtures + VAD pure math + worker selection)
  - `npm run typecheck`, `npm run lint`, `npm run build`, `.mfactory/hooks/run-tripwires.sh --all` -> all green/clean
  - real worker run: seeded [2s tone][3s silence][4s tone], `ERIKA_WORKER_ONCE=1 npm run worker` -> queued->done, 2 segments, normalized.wav + 2 seg files + 2 hash-named cache renditions
  - resumability w/o duplication: forced job -> processing/segmenting (simulated crash), re-ran worker -> reclaimed & completed, segments stayed 2, normalized.wav mtime unchanged (normalize skipped); criterion-8 test covers checkpoint-after-normalize/segmenting resume
  - memory-safe/long: criterion-9 test processes a 3-minute alternating tone/silence fixture to 12 segments and asserts no ingest module has a full-file read path (audio is ffmpeg file->file; hash streamed)
Risks:
  - silencedetect thresholds (noise=-30dB, d=0.3s) tuned for clean speech; real day dumps may need calibration (learned VAD = noted future upgrade)
  - content hash is over the segment WAV bytes (deterministic PCM+header), not raw PCM only; stable/equal for identical audio in practice
Blocker: none
```
