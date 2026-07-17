# WO-ingest-ui — E-3 Smart ingest (part 2 of 2): the ingest UI

Target repo: github.com/immaculatecross/erika · Branch: `feat/ingest-ui` · Diff cap: ~400 lines (excl. lockfile)

**Milestone context.** Part 2 of 2 of E-3, and it **completes the milestone**. Part 1 (the async pipeline: normalize → VAD → segments → dedup/cache → renditions, resumable + memory-safe, driven by `npm run worker`) is **already merged on `master`**. This part is the **read-only UI** that surfaces what the pipeline produces, plus live progress. Do not change the pipeline, worker, or migrations — add read accessors/routes and UI only.

## What already exists (reuse, don't reinvent)

- `lib/segments.ts`: `listSegments(db, sessionId) → Segment[]` (each has `idx`, `startMs`, `endMs`, `durationMs`, `contentHash`); `countByHash`. Add a small summary helper here if useful (e.g. total speech ms).
- `lib/ingest/pipeline.ts`: `IngestJob` (fields include `state` queued/processing/done/failed, `stage`, `progress` 0–1, `error`) and `getJob(db, id)`. The `ingest_jobs` row is keyed per session — add a `getJobBySession(db, sessionId)` read accessor if one isn't present.
- `app/sessions/[id]/page.tsx` (detail + audio player) and `GET /api/sessions/[id]/audio` (HTTP Range) — reuse the player for click-to-seek.
- The Sessions list already shows a job-state badge (E-2). The worker (`npm run worker`) drains queued jobs — the UI only reflects state; it does not run the worker.

## Objective

On the session detail page, the ingest job is legible end to end. While it is queued/processing, a restrained progress indicator shows the current stage and advances **without a manual reload** (client polling). When it is done, the page shows **raw-vs-speech time** — the raw recording duration against the total detected speech time, e.g. "6h 2m → 47m speech" — and a **segment timeline** visualizing where speech falls across the recording, where selecting a segment seeks the audio player to that moment. A failed job shows its truthful error; a done job that found no speech says so quietly. No analysis, no findings, no model calls (that is E-4).

## Acceptance criteria

Each becomes at least one test that fails if the behavior were wrong.

1. **Live progress, no reload.** A `GET /api/sessions/[id]/ingest` route returns `{ state, stage, progress, error }` plus the speech summary and segments. While `state ∈ {queued, processing}` the detail page polls it and updates the shown stage/progress; when the job reaches `done` or `failed` the view transitions to the result/error **without a manual page reload**, and polling stops. (Test: unit-test the route's payload; Playwright — seed/advance a job from `processing` to `done` (drive the worker or update the row) and assert the UI updates without reload and stops polling.)
2. **Raw vs speech time.** On a `done` session the page shows the raw duration (`session.duration_seconds`) and the total speech time (sum of segment `durationMs`) with the reduction, tabular numerals, DESIGN copy (e.g. "6h 2m → 47m speech", not "Great!"). (Test: a pure summary helper — given segments summing to S and raw R, returns the right totals/labels across h/m/s boundaries.)
3. **Segment timeline.** A horizontal timeline spanning the recording renders each speech segment as a block at its proportional start/end (silence = gaps), with the segment count shown; selecting a segment seeks the reused audio player to that segment's start. (Test: given N segments, N blocks render at correct proportional offsets; selecting one drives the player's currentTime — component or e2e.)
4. **Truthful failed / empty states.** A `failed` job shows its stored `error` (never a fake success); a `done` job with zero segments shows a quiet, specific "no speech detected" line. (Test: failed → error visible; empty → truthful message.)

## Files and constraints

- **New read route:** `app/api/sessions/[id]/ingest/route.ts` (Node runtime; GET only). No write endpoints. Reuse the data layer; add only read accessors (`getJobBySession`, a speech-summary helper).
- **UI:** extend `app/sessions/[id]/page.tsx`; new components e.g. `components/segment-timeline.tsx` and a progress element (fold into the page or a small `components/ingest-status.tsx`). A client polling hook (poll only while queued/processing; clear on unmount and on terminal state).
- **DESIGN.md is binding.** Calm, monochrome, black/white accent, green/red only for meaning (D-14: a `failed` state may use red, a completed/mastered feel green). Tabular numerals for all durations. The progress indicator should be restrained — **do not build the elaborate "analysis progress orb"; that signature moment belongs to E-4.** Transform/opacity motion only; `prefers-reduced-motion` degrades to fades/no motion.
- **Do not touch** the pipeline (`lib/ingest/*` processing), the worker, migrations, or the E-2 upload/capture/audio contracts. Additive read-only work only. If you think a processing change is required, stop and report `blocked`.
- **Repo rules:** files < 500 lines; Conventional Commits; never commit anything under `data/`; hooks armed; the `gates` CI check must pass.

## Out of scope (do not touch)

- Any model/API call, triage, cost estimate, findings, or analysis (E-4).
- Auto-spawning the worker from the app (a future nicety) — document that `npm run worker` processes jobs.
- Flashcards (E-5); auth/hosting; changing E-3a's pipeline/schema.

## Milestone ritual (this PR completes E-3)

Flip **FEATURES.md E-3 `building → done`** and **E-4 `backlog → next`**, and **regenerate STATE.md** (one screen) to reflect that Smart ingest shipped (captures are processed into deduplicated, timestamped speech segments with triage renditions, resumably and memory-safely; the session page shows raw-vs-speech and a segment timeline with live progress) and E-4 Analysis is next. Keep it truthful — the reviewer checks.

## PR description must state

What changed per area, the **exact commands** used to verify each criterion (including how you proved the no-reload live update), what they proved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/8  (branch feat/ingest-ui → master)
Changed:  getJobBySession read accessor (lib/ingest/pipeline.ts)
          pure raw-vs-speech summary + span formatter (lib/ingest-view.ts)
          GET /api/sessions/[id]/ingest — state/stage/progress/error + summary + segments (Node, GET only)
          useIngest polling hook — polls while queued/processing, stops on terminal, clears on unmount (lib/use-ingest.ts)
          ingest-status.tsx — restrained transform-only progress bar + done/failed/empty states (not the E-4 orb)
          segment-timeline.tsx — proportional speech blocks that seek the reused audio player
          session detail page wired to the hook, live badge, click-to-seek (app/sessions/[id]/page.tsx)
          milestone ritual: FEATURES.md E-3 building→done, E-4 backlog→next; STATE.md regenerated
Verified: npm run typecheck, npm run lint — clean.
          npm run test — 74 unit tests pass; ingest-view.test.ts proves summary/labels across h/m/s
            boundaries (criterion 2); ingest-route.test.ts proves the payload for
            processing/done/empty/failed (criteria 1, 4).
          npx playwright test e2e/ingest-ui.spec.ts — 4/4 pass on a real WAV + real DB:
            criterion 1 — seed processing, load (shows 70%), flip row to done; the section
              transitions to the result without reload (a window marker set pre-flip survives) and
              data-poll-count freezes after the terminal state (polling stopped);
            criterion 3 — two segments render at exact proportional offsets (data-left/data-width) and
              clicking a block drives the audio element currentTime to the segment start (~5.0s);
            criterion 4 — failed shows its stored error and no timeline; done with zero segments shows
              "No speech detected".
          npm run build — production build succeeds; the new route is registered.
          npm run screenshot -- /sessions/<id> — visual check of the done state (raw-vs-speech line,
            proportional monochrome timeline, tabular numerals, green Ready badge only).
Risks:    Worker is not auto-spawned by the app (out of scope); npm run worker drains jobs, the UI only
          reflects state. Poll cadence is 1s (NEXT_PUBLIC_INGEST_POLL_MS); a job finishing between polls
          surfaces within one interval.
Blocker:  none
```
