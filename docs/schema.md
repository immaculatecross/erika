# Database schema

SQLite (better-sqlite3) at `data/erika.db` (`ERIKA_DB_PATH` overrides). Applied by
the runner in `lib/db.ts` from the append-only list in `lib/migrations/index.ts`;
`_migrations` records the versions already applied. **Latest version: v13.**

> **Ritual.** Adding a migration updates this file in the same PR. A schema doc
> that lags the schema is worse than none — it is believed and it is wrong.

## The shape of it

A **session** is one recording. Ingest cuts it into **segments** — the intervals
where someone is speaking — each content-hashed. Analysis reads segments and
writes **findings**, one per mistake. Every finding becomes a **card**. Findings
group into patterns that become **lessons**.

```
sessions ──< ingest_jobs                    (one ingest run per upload)
         ──< analysis_jobs                  (one row per Analyze press)
         ──< segments ──┐
         ──< findings ──┤ content_hash (not an FK — the cache key)
                        └──> segment_analyses
findings ──1:1── cards ──< (SM-2 state)
findings ──1:1── deleted_findings           (tombstone: "do not re-card")
findings ──1:1── finding_slips ──> slips    (one recurring mistake = one slip)
findings ──1:1── renditions                 (render-once contrastive-playback clip)
findings ──1:1── ask_notes                  (ask-once deeper note, cites other findings)
lessons / lesson_mastery ── pattern_key     (no session FK — derived from all findings)
spend_ledger                                (no FK at all — money outlives sessions)
```

`content_hash` is a SHA-256 of the extracted segment audio and the spine of the
cost model (D-10): identical audio is analysed once, ever. It deliberately is not
a foreign key — `segment_analyses` and `spend_ledger` are keyed by hash so they
survive the deletion of any one session that happened to contain that audio.

## Tables

| Table | v | Key | What it holds |
|---|---|---|---|
| `settings` | 1 | `key` | Target/native language, model tier, monthly budget. Values are text. |
| `sessions` | 2 | `id` | One uploaded or recorded file: filename, format, bytes, duration, `created_at`. Deleting cascades to jobs, segments, findings. |
| `ingest_jobs` | 2, 3, 8 | `id` | The speech-extraction run for a session: `state` (queued/processing/done/failed), `stage`, `progress`, `error`, and the v8 lease (`worker_id`, `heartbeat_at`). |
| `segments` | 3 | `id`, unique `(session_id, idx)` | One kept speech interval: original-timeline `start_ms`/`end_ms`/`duration_ms` and its `content_hash`. |
| `findings` | 4, 8, 10 | `id`, unique `(session_id, content_hash, start_ms, quote, correction, category)` | One correction: `quote` → `correction`, `category`, `explanation`, `severity`, timestamps. The v8 identity index makes a replayed write idempotent — it is not a defence against a double run (the lease is). From v10, nullable `recurrence_of`: the CLIPPED (≤60-char, ellipsis-terminated) correction text of the speaker-profile entry the deep model marked this finding as recurring (`lib/analysis/profile.ts` clips it for the prompt, so the stored link is a prefix of the full correction, never equal to it); NULL everywhere the model made no such claim. |
| `analysis_jobs` | 4, 8 | `id` | One cascade run: `state` (queued/processing/done/failed/**halted**), `stage`, `progress`, `error`, plus the v8 lease. `halted` = the budget cap stopped it. |
| `segment_analyses` | 4, 9 | `content_hash` | The never-re-bill witness: `flagged` (triage's verdict), `deep_done`, and from v9 `unreadable` + `unreadable_reason` + `response_shape` (content-free). **This table is what "analysed" means** — see `lib/findings-model.ts`. |
| `spend_ledger` | 4 | `id` | One row per real billable call: `month` ('YYYY-MM'), `model`, `content_hash`, `cost_usd`. No session FK — deleting a session must never erase spend history. |
| `cards` | 5 | `id`, unique `finding_id` | The drill card and its SM-2 state (`ease`, `interval_days`, `repetitions`, `due`, `last_grade`, `suspended`). |
| `deleted_findings` | 6 | `finding_id` | Tombstone so a deliberately deleted card is not regenerated. Pinning from the Phrasebook clears it. |
| `lessons` | 7 | `id`, unique `pattern_key` | One generated lesson per recurring pattern (`category:<category>`, `lib/lessons/patterns.ts`); `exercises` is JSON. Unique = generated once, re-opened free. |
| `lesson_mastery` | 7 | `pattern_key` | Per-pattern mastery 0..1, updated by the EMA rule in `lib/lessons/mastery.ts`. |
| `slips` | 11 | `id`, unique `slip_key` | One recurring mistake (E-20): `category`, the representative `correction`, and the deterministic `slip_key` (`category:<normalized correction>`). A materialization of the pure clustering in `lib/slips.ts`, upserted by key so re-analysis of the same findings keeps the same id. State (active/remission/resolved) is computed, never stored. |
| `finding_slips` | 11 | `finding_id` | The finding→slip association: one slip per finding, cascade-deleted with its finding. Rewritten idempotently by `materializeSlips`. |
| `renditions` | 12 | `finding_id` | One contrastive-playback rendition per finding (E-21): `path` (mp3 under `data/renditions/`), `cost_usd` (the actual TTS charge, also ledgered once). The `finding_id` PK is both the render-once cache key and the render lease: the engine claims the row BEFORE the budget check and the provider call (lease-before-spend), so exactly one racing Generate calls the model and bills — the loser makes no call and no ledger row (D-15). An uncommitted claim (budget refusal / failed synthesize) is released so a retry can re-lease. FK cascade on delete; the file is cleaned by the delete route and playback is orphan-safe without it. |
| `ask_notes` | 13 | `finding_id` | One ask-once deeper note per finding (E-23): `note` text, `cited_ids` (JSON array of the OTHER findings the note cites — ≥1, structurally enforced and resolvable to real included findings), `cost_usd` (the actual text charge, also ledgered once). The `finding_id` PK is both the ask-once cache key and the ask lease: the engine claims the row (with an empty `note`) BEFORE the budget check and the text-model call (lease-before-spend, mirroring `renditions`), so exactly one racing Ask calls the model and bills — the loser makes no call and no ledger row (D-15). The winning call completes the row (fills `note`/`cited_ids`); the cache read returns only completed rows, and every handled failure (budget refusal, a failed/unreadable call) releases the claim so a retry can re-lease. FK cascade on delete — no on-disk file, so the cascade is the whole cleanup. |

Timestamps are SQLite UTC text (`datetime('now')`, `"YYYY-MM-DD HH:MM:SS"`) so
they compare and sort as strings; `lib/jobs/liveness.ts` parses them to epoch ms.

## Reading findings

Do not query `findings` directly from a feature. `lib/findings-model.ts` defines
the scope once — what an analysed segment, an analysed session, and an included
finding are, and how a halted run and an in-flight re-analysis are treated — and
every surface reads through it. Six surfaces once answered that question six ways
and disagreed with each other (E-17). Note that `segment_analyses` witnesses are
hash-shared across sessions (the cache), so the session scopes additionally
require an analysis run of the session's own past `queued`: a byte-identical
re-upload contributes nothing anywhere until its own Analyze runs.

## Migration history

| v | Name | Adds |
|---|---|---|
| 1 | `settings` | `settings` |
| 2 | `sessions_and_ingest_jobs` | `sessions`, `ingest_jobs` |
| 3 | `segments_and_job_checkpoints` | `segments`; ingest checkpoint columns |
| 4 | `findings_analysis_jobs_spend_ledger` | `findings`, `analysis_jobs`, `segment_analyses`, `spend_ledger` |
| 5 | `cards` | `cards` |
| 6 | `deleted_findings_tombstone` | `deleted_findings` |
| 7 | `lessons_and_mastery` | `lessons`, `lesson_mastery` |
| 8 | `job_lease_and_findings_identity` | lease columns on both job tables; `idx_findings_identity` (dedupes existing rows first) |
| 9 | `segment_unreadable` | `unreadable`, `unreadable_reason`, `response_shape` on `segment_analyses` |
| 10 | `findings_recurrence` | nullable `recurrence_of` on `findings` — the profile-entry recurrence link, storing the entry's CLIPPED (≤60-char) correction, not the full one (E-19) |
| 11 | `slips` | `slips`, `finding_slips` — persistent recurring-mistake clusters and the finding→slip association (E-20) |
| 12 | `renditions` | `renditions` — the render-once contrastive-playback cache, one row per finding (E-21) |
| 13 | `ask_notes` | `ask_notes` — the ask-once deeper-note cache, one row per finding, citing ≥1 other finding (E-23) |

Never edit a shipped migration — add the next one. `tests/migrations.test.ts`
asserts a fresh database reaches the latest version and that re-running is a no-op.
