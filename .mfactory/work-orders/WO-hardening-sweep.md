# WO-hardening-sweep — E-16 Hardening (part 2 of 2): make it work for a real user

Target repo: github.com/immaculatecross/erika · Branch: `feat/hardening-sweep` · Diff cap: ~500 lines (excl. lockfile & fixtures). **Completes E-16.**

**Milestone context.** Part 1 (the four confirmed integrity defects) is merged. This part fixes **what the operator actually hit running v0.2 by hand** — every item below is a real, observed failure, not a hypothetical. Priority is a working end-to-end experience, not exhaustive defence: prefer the fix a user would notice over belt-and-braces around it. Where a choice arises between shipping the user-visible fix and gold-plating its edges, ship the fix and note the edge.

## The operator's session, in order of what broke

1. **Nothing processed.** An upload sat `queued` forever; clicking Analyze queued a second job that also sat. Cause: the worker is a separate process and the app never says so.
2. **The worker can't see the API key.** `npm run worker` is `tsx scripts/worker.ts` — no `--env-file`, `dotenv` not installed — so `process.env.OPENAI_API_KEY` is `undefined` in the process that actually runs the cascade. Every real-API smoke to date called the client directly, so the production path was never once exercised with the real key.
3. **VAD excluded real speech** — parts of genuine utterances were dropped.
4. **"Analysis failed — Model response was not a JSON object"** — and it killed the whole run.

## Acceptance criteria

Each becomes at least one test. All tests run with **no network**.

1. **The worker sees the environment.** `npm run worker` loads `.env.local` (e.g. `node --env-file`, or an explicit loader — pick one and document it in the README). On startup, if `OPENAI_API_KEY` is absent the worker **says so loudly and exits non-zero** rather than failing later at the first model call. (Test: the loader resolves the key; a missing key produces the truthful startup error.)
2. **Worker liveness is visible.** A job that has sat `queued` (or `processing`) past a stale threshold with no live worker heartbeat surfaces a plain, actionable line in the UI — e.g. *"Not processing — start the worker with `npm run worker`."* — instead of a calm indefinite badge. The heartbeat/lease columns from part 1 give you the signal. (Test: a stale queued job renders the message; a fresh/processing one does not.)
3. **VAD keeps real speech.** Replace the fixed −30 dB floor with a **noise floor measured from the recording itself** (threshold relative to that floor), add **pre/post-roll padding** (~200–300 ms) so onsets and offsets aren't clipped, and **widen the merge gap** (natural mid-sentence pauses exceed 300 ms — pick a defensible value and document it). Revisit the 2 s minimum. Per **mfactory D-13**, a synthetic tone fixture proves the mechanism but cannot falsify calibration: commit **one short real-speech sample with labelled speech regions** (record or synthesize speech-like audio with known spans — a few seconds is enough) and assert **recall of the labelled regions** above a stated threshold. State the chosen parameters and why. (Test: the labelled-sample recall assertion; existing tone tests still pass.)
4. **One bad model response no longer kills the run.** Check `finish_reason` and treat **truncation** as its own explicit error (likely the operator's actual cause). On an unparseable reply, make **one bounded repair retry** with a stricter JSON-only instruction; if it still fails, mark **that segment** unreadable and **continue the run** — the job completes and reports honestly, e.g. *"14 of 15 segments analysed · 1 unreadable"*, instead of failing wholesale. Persist the offending response's shape (truncated/redacted, no secrets) so the failure distribution becomes visible. Spend recording from part 1 stays intact. (Test: a truncated reply and an unparseable reply each leave the run `done` with the segment marked unreadable and the count reported; the retry happens exactly once.)
5. **Analyze is gated on ingest.** No analyze affordance (or a truthful disabled state explaining why) until the session actually has segments — today an un-ingested session offers Analyze, estimates $0, runs, and reports "no findings," which reads as a clean bill of health. (Test: a session with no segments does not offer a runnable Analyze; one with segments does.)
6. **Two truthfulness fixes.** A mic take whose decode/encode fails must tell the user it was lost instead of silently discarding it (`lib/use-recorder.ts` → `components/recorder.tsx`); and the ingest/analysis polling hooks must **stop on 404/410** (deleted session) instead of polling every second forever.
7. **Port the NUL-byte pre-commit gate** into `.mfactory/hooks/pre-commit` (already live in the canonical mfactory kit): a staged source file containing a raw NUL byte is blocked, because git serves it as binary and it bypasses diff review entirely. Negative-test it.

## Files and constraints

- Likely touched: `package.json` (worker script), `scripts/worker.ts`, `lib/ingest/vad.ts`, `lib/analysis/audio-model.ts` + `cascade.ts`, `lib/use-ingest.ts` / `lib/use-analysis.ts`, `lib/use-recorder.ts`, `components/recorder.tsx`, `components/analysis-panel.tsx`, the session detail page, `.mfactory/hooks/pre-commit`, README.
- **Deferred to a later cleanup — do NOT do here:** `data/cache` eviction/temp-sweep, and the cosmetic polish list (inline hex, formula copy, empty-state buttons, card-browser filters, etc.).
- Migrations append-only (latest **v8**); add v9 only if genuinely required.
- Files < 500 lines; Conventional Commits; hooks armed; `gates` green; never commit anything under `data/`.

## Milestone ritual (this PR completes E-16)

Flip **FEATURES.md E-16 `building → done`** and **E-17 `backlog → next`**; regenerate **STATE.md** (one screen) noting that v0.3 hardening shipped and E-17 is next.

## PR description must state

What changed per item, the exact verification commands, the VAD parameters chosen and the recall figure achieved, and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/22  (branch feat/hardening-sweep)
Changed:
  1. Worker environment — new `lib/env-file.ts` (dependency-free .env.local loader,
     shell/CI vars win); `scripts/worker.ts` loads it before any module reads a secret
     and exits non-zero at boot with the fix in the message when OPENAI_API_KEY is
     absent. Chose an explicit loader over `node --env-file` (hard-fails when the file
     is absent; `--env-file-if-exists` needs Node 20.12 and the repo's floor is 20) —
     documented in the README's new "The worker" section.
  2. Worker liveness — new `lib/jobs/liveness.ts` (pure verdict + row lookup) reusing
     part 1's heartbeat lease; `workerAbsent` on both view models and routes; new
     `components/worker-absent-notice.tsx` rendered by ingest and analysis.
     `lib/jobs/lease-config.ts` splits the threshold out of `lease.ts` so a client
     component can read it without pulling node:crypto into the bundle.
  3. VAD recalibration — `lib/ingest/vad.ts`: threshold measured from the recording's
     own noise floor (ffmpeg `astats`) instead of a fixed −30 dB, 250 ms pre/post-roll
     padding, merge gap 300→700 ms, minimum 2000→1600 ms; committed labelled sample +
     generator + recall assertion (D-13).
  4. One bad reply no longer kills the run — `ModelTruncatedError`, `finish_reason`
     checked, one bounded repair retry with a strict JSON-only instruction (both
     attempts ledgered), then the segment is marked unreadable with a content-free
     response shape (migration v9) and the run completes reporting
     "N of M segments analysed · K unreadable".
  5. Analyze gated on ingest — POST 409s a session with no segments; the panel shows a
     truthful disabled state instead of offering a $0 run that reads as a clean bill.
  6. Truthfulness — a lost mic take now says so (`takeOutcome` + `lost` error kind,
     red/alert in the recorder); `lib/poll.ts` stops both polling hooks on 404/410.
  7. Pre-commit NUL-byte gate ported into `.mfactory/hooks/pre-commit`, scoped to
     source extensions, with a driven negative test.
Verified:
  npm run lint · npm run typecheck · npm run build · npm run test  → 286 tests, 42 files,
    all green, no network (every model client mocked).
  Live, against a throwaway DB on a dev server (data/ was wiped and is regenerable):
    - worker with no key and no .env.local → truthful message, exit=1; with .env.local
      → "[worker] started (1 var(s) from .env.local)", exit=0.
    - upload → queued; aged the job → GET /ingest workerAbsent=true; session page shows
      "Not processing — start the worker with `npm run worker`".
    - POST /analysis on the un-ingested session → 409; page shows the disabled Analyze
      and "Nothing to analyze yet"; after `npm run worker` → 4 segments, POST → 202.
    - deleted the session under an open page → both hooks polling=false, poll count
      frozen (3 → 3) instead of a 404 every second.
  VAD parameters chosen: threshold = measured noise floor + 12 dB, clamped to
    [−55, −30] dBFS (the ceiling is the old fixed floor, so the rule can never be more
    aggressive than the behaviour that was dropping speech); silencedetect d = 0.3 s;
    pre/post-roll 250 ms; merge gap 700 ms; minimum segment 1600 ms (post-padding).
    On the committed labelled sample: recall 1.000 (kept 13.1 s of 17 s, so silence is
    still discarded); the pre-E-16b parameters score 0.515 on the same sample, and a
    test asserts that they do — the fixture can falsify, per D-13.
Risks:
  - The noise floor is measured once over the whole file. A recording whose room
    changes partway (quiet room → café) gets one compromise threshold; a windowed
    floor is the honest next step and is noted here rather than built.
  - The calibration rests on one synthetic-but-labelled sample. It discriminates the
    old parameters from the new decisively, but it is not a corpus: the numbers are
    defensible, not proven optimal across real voices and rooms.
  - Padding raises kept audio ~15-25 % (measured 13.1 s kept for 10.2 s of labelled
    speech), so billed model-time rises with it. That is the recall/cost trade the WO
    asked for, taken deliberately in favour of not losing the user's words.
  - `QUEUED_STALE_MS` is 20 s. A worker that is alive but wedged inside a single very
    long ffmpeg pass on ANOTHER job will make a newly queued job read as un-worked for
    the duration. It says "start the worker", which is harmless if one is running.
  - An unreadable segment stays pending, so a later run retries it (and re-bills that
    call). Deliberate — a truncation is usually transient — but it does mean a
    persistently unreadable segment is paid for on every re-analyze.
  - Migration v9 adds three columns to `segment_analyses`; append-only, no backfill.
Blocker:  none
```
