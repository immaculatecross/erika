# WO-findings-truth — E-17 One findings truth (v0.3 · milestone 2)

Target repo: github.com/immaculatecross/erika · Branch: `feat/findings-truth` · Diff cap: ~500 lines (excl. lockfile & fixtures)

**Milestone context.** Second milestone of v0.3. E-16 (hardening) is merged. Six surfaces answer the question *"what are the user's findings?"* six different ways and **disagree**; this milestone makes them agree, moves the aggregates into SQL, and documents the schema. It is the prerequisite for E-19/E-20 (profile-primed analysis and slips), which both read findings across sessions and must not inherit today's contradictions.

## The disagreement to resolve (found by the retro's technical lens)

The same question is answered six ways: per-session `listFindings` (report), `listAllFindings` (phrasebook, lesson patterns), `listAllFindingsWithSession` (archive), per-session loops gated on **latest job `done`** (`lib/focus.ts:163-173`, `lib/letter.ts:261-278`), and raw SQL inside `generateCards` (`lib/cards.ts:101-109`). The gates disagree: **focus and letter drop a whole session the instant a re-analysis is enqueued** (its latest job flips to `queued`) or when a run halts at the budget cap, while phrasebook, archive, patterns and cards happily include those same partial-run findings. So the letter can say "3 findings this week" while the phrasebook shows 9 from that same week.

## Acceptance criteria

Each becomes at least one test. All tests run with **no network**.

1. **One canonical read-model.** A single `lib/findings-model.ts` defines the scopes once — what counts as an **analysed session** and an **included finding** — and documents the semantics for a **halted** run and a **re-analysis in flight**. All six read sites consume it; none re-implements its own gate. (Test: the two previously-divergent cases — a session with a re-analysis enqueued, and a budget-halted run — now yield the *same* set/count across focus, letter, phrasebook, archive, cards and lesson patterns.)
2. **Aggregates in SQL.** Focus and letter compute their per-category / per-week rates with SQL `GROUP BY` instead of running 3 queries per session for every session on every GET, with **identical results** to today's implementation on fixtures. (Test: old-vs-new equivalence over a seeded multi-session, multi-week fixture, including the zero-speech and single-week edge cases already covered.)
3. **Schema documentation.** A `docs/schema.md` describing the tables and their relationships across migrations v1–v9 (sessions, ingest_jobs, segments, findings, segment_analyses, spend_ledger, cards, deleted_findings, lessons, lesson_mastery, analysis_jobs), and a line binding it to the migration ritual — adding a migration updates this doc. Keep it terse and true.

## Fold-in fixes (small, from PR #22's review — do these too)

4. **User-visible bug:** `components/analysis-panel.tsx:169-186` renders `WorkerAbsentNotice` **unconditionally** inside `NotIngestedYet`, ignoring `view.workerAbsent` — so on every healthy upload the page shows a live ingest bar *and*, directly beneath it, "Not processing — start the worker". The signal is permanently on and therefore meaningless. Consult the verdict, and add the **render-level** test the milestone's criterion lacked (a fresh/processing job must NOT render the notice).
5. **False count on a halted run:** `lib/analysis-view.ts:73-76` computes `analysed = segmentCount − unreadableCount`, which is exact on `done` but wrong on `halted` — it reported "5 of 6 segments analysed · 1 unreadable" when 1 was analysed, 1 triaged only and 3 never touched. Fix it as part of criterion 1's canonical counting (this is exactly the semantics this milestone owns). (Test: a halted run reports a truthful analysed count.)
6. **Two small truthfulness fixes in the env loader:** `lib/env-file.ts:70`'s comment still justifies its design with "ingest-only runs legitimately have no key", which the boot check now contradicts (the worker exits 1 without a key) — make the comment true; and `parseEnvFile` keeps inline comments, so `KEY=sk-abc # note` yields `sk-abc # note` and fails later as a 401 — strip an unquoted trailing `#` comment, with a test.

## Files and constraints

- New: `lib/findings-model.ts`, `docs/schema.md`. Touched: `lib/focus.ts`, `lib/letter.ts`, `lib/analysis/findings.ts`, `lib/cards.ts`, `lib/archive.ts`, `lib/phrasebook.ts`, lesson patterns, `lib/analysis-view.ts`, `components/analysis-panel.tsx`, `lib/env-file.ts`.
- **This is a consolidation, not a redesign** — behaviour changes only where today's surfaces contradict each other; pick the semantics that is most truthful to the user, state which you chose and why, and make every surface follow it.
- Do NOT change: the cascade's model behaviour, prompts, rates, VAD calibration, the SM-2 scheduler, or the ingest pipeline.
- Migrations append-only (latest **v9**); add v10 only if genuinely required (it probably is not — this is a read-model milestone).
- Files < 500 lines; Conventional Commits; hooks armed (incl. the NUL-byte gate); `gates` green; never commit anything under `data/`. The dev database is disposable — create/destroy freely.

## Milestone ritual (this PR completes E-17)

Flip **FEATURES.md E-17 `next → done`** and **E-18 `backlog → next`**; regenerate **STATE.md** (one screen).

## PR description must state

The canonical semantics you chose for halted runs and in-flight re-analysis and why; the exact verification commands; the old-vs-new aggregate equivalence evidence; and risks. Conventional-Commit title.

## Exit report

Append the `task.md` exit report block (RESULT / PR / Changed / Verified / Risks / Blocker) here and as your final message.

---

## Exit report

```
RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/24
Changed:  lib/findings-model.ts — the canonical read-model: one SQL predicate
          (a complete segment_analyses witness) defines analysed segment /
          included finding / analysed session; all six read sites consume it.
          lib/focus.ts, lib/letter.ts — collect via two GROUP BY queries each
          instead of three per session; halted + re-analysis-in-flight now count.
          lib/cards.ts, the phrasebook/archive/patterns/lessons-generate routes,
          the session-report route — read through the model, no local gates.
          lib/analysis/findings.ts — listAllFindings(WithSession) moved to the
          model; countUnreadableSegments superseded by sessionSegmentCounts.
          lib/analysis-view.ts + components/analysis-panel.tsx — the tally counts
          witnesses instead of subtracting, and speaks on an incomplete run.
          components/analysis-panel.tsx — WorkerAbsentNotice no longer renders
          unconditionally in NotIngestedYet (fold-in 4).
          lib/env-file.ts — the stale rationale corrected; parseEnvFile strips an
          unquoted trailing # comment (fold-in 6).
          docs/schema.md — v1-v9, bound to the ritual by tests/migrations.test.ts.
          tests/ — findings-truth, focus-aggregate, analysis-panel-render (.tsx),
          plus migrations/worker-env/analysis-view additions. 307 green.
Verified: npm run lint (clean) · npm run typecheck (clean) · npm run test
          (307 passed / 46 files, no network — every model client mocked) ·
          npm run build (exit 0) · .mfactory/hooks/run-tripwires.sh (exit 0).
          End to end on a throwaway DB seeded with the exact contradiction:
          a halted run (6 segments, 3 analysed, 9 findings) + a session with a
          re-analysis queued. /api/focus, /api/letter, /api/phrasebook,
          /api/archive, cards and the session report all reported 15; the
          session page rendered "3 of 6 segments analysed"; /focus showed
          "5.0 h of analyzed speech · 15 findings · 2 sessions". Before E-17
          that same DB gave Focus and the letter zero.
Risks:    Behaviour changes where the surfaces contradicted each other, stated
          in the PR. Findings from a `failed` run whose segments completed now
          count everywhere (they always did on four of six surfaces). A session
          whose ingest produced segments the analysis never reached is denominated
          on the analysed part only, so its rate can move when a run resumes —
          truthful, but a rate over 3 of 6 hours is a smaller sample than the
          number alone suggests. The equivalence and divergence evidence is
          fixture-based (mfactory D-13): it proves the mechanism, not that the
          chosen semantics is what a real user would prefer.
Blocker:  none
```
