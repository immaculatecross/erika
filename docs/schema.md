# Database schema

SQLite (better-sqlite3) at `data/erika.db` (`ERIKA_DB_PATH` overrides). Applied by
the runner in `lib/db.ts` from the append-only list in `lib/migrations/index.ts`;
`_migrations` records the versions already applied. **Latest version: v9.**

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
| `findings` | 4, 8 | `id`, unique `(session_id, content_hash, start_ms, quote, correction, category)` | One correction: `quote` → `correction`, `category`, `explanation`, `severity`, timestamps. The v8 identity index makes a replayed write idempotent — it is not a defence against a double run (the lease is). |
| `analysis_jobs` | 4, 8 | `id` | One cascade run: `state` (queued/processing/done/failed/**halted**), `stage`, `progress`, `error`, plus the v8 lease. `halted` = the budget cap stopped it. |
| `segment_analyses` | 4, 9 | `content_hash` | The never-re-bill witness: `flagged` (triage's verdict), `deep_done`, and from v9 `unreadable` + `unreadable_reason` + `response_shape` (content-free). **This table is what "analysed" means** — see `lib/findings-model.ts`. |
| `spend_ledger` | 4 | `id` | One row per real billable call: `month` ('YYYY-MM'), `model`, `content_hash`, `cost_usd`. No session FK — deleting a session must never erase spend history. |
| `cards` | 5 | `id`, unique `finding_id` | The drill card and its SM-2 state (`ease`, `interval_days`, `repetitions`, `due`, `last_grade`, `suspended`). |
| `deleted_findings` | 6 | `finding_id` | Tombstone so a deliberately deleted card is not regenerated. Pinning from the Phrasebook clears it. |
| `lessons` | 7 | `id`, unique `pattern_key` | One generated lesson per recurring pattern (`category:<category>`, `lib/lessons/patterns.ts`); `exercises` is JSON. Unique = generated once, re-opened free. |
| `lesson_mastery` | 7 | `pattern_key` | Per-pattern mastery 0..1, updated by the EMA rule in `lib/lessons/mastery.ts`. |

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

Never edit a shipped migration — add the next one. `tests/migrations.test.ts`
asserts a fresh database reaches the latest version and that re-running is a no-op.
