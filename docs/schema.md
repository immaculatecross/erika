# Database schema

SQLite (better-sqlite3) at `data/erika.db` (`ERIKA_DB_PATH` overrides). Applied by
the runner in `lib/db.ts` from the append-only list in `lib/migrations/index.ts`;
`_migrations` records the versions already applied. **Latest version: v20.**

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

knowledge_items ──< evidence                (append-only log; derived state is a cache)
                ──< spill_queue             (composer overflow; wired in v0.5)
                ──1:1── item_lessons        (generate-once micro-lesson cache, E-32)
cards ──> knowledge_items                   (nullable item_id: a review = evidence, E-25)
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
| `findings` | 4, 8, 10, 16 | `id`, unique `(session_id, content_hash, start_ms, quote, correction, category)` | One correction: `quote` → `correction`, `category`, `explanation`, `severity`, timestamps. The v8 identity index makes a replayed write idempotent — it is not a defence against a double run (the lease is). From v10, nullable `recurrence_of`: the CLIPPED (≤60-char, ellipsis-terminated) correction text of the speaker-profile entry the deep model marked this finding as recurring (`lib/analysis/profile.ts` clips it for the prompt, so the stored link is a prefix of the full correction, never equal to it); NULL everywhere the model made no such claim. From v16, nullable `notes`: the E-28 enriched-observation channel — a small JSON object `{pronunciation?, register?, disfluency?}` (a pronunciation suspect, an italiano-colto register upgrade, a disfluency note; each an optional short string), chosen over new categories so the closed `category` vocabulary every surface switches on is untouched; NULL when the model returned no enrichment. |
| `analysis_jobs` | 4, 8 | `id` | One cascade run: `state` (queued/processing/done/failed/**halted**), `stage`, `progress`, `error`, plus the v8 lease. `halted` = the budget cap stopped it. |
| `segment_analyses` | 4, 9 | `content_hash` | The never-re-bill witness: `flagged` (triage's verdict), `deep_done`, and from v9 `unreadable` + `unreadable_reason` + `response_shape` (content-free). **This table is what "analysed" means** — see `lib/findings-model.ts`. |
| `spend_ledger` | 4, 15 | `id` | One row per billable call: `month` ('YYYY-MM'), `model`, `content_hash`, `cost_usd`. No session FK — deleting a session must never erase spend history. From v15, `state` ∈ {pending, committed} (DEFAULT committed — every pre-v15 row is a real finalized charge) + `reserved_at`: the E-27 reserve-before-call machinery so the cap stays hard under the concurrency pool. A call inserts a **pending** row for its estimated cost *before* it fires (`reserveSpend`, atomic: committed + pending + cost ≤ cap or refused), then **finalizes** it to committed on resolve (`finalizeReservation`, in the same txn as findings + witness) or **releases** it on a no-charge failure. The cap counts committed + pending; `monthToDateSpend`/`wouldExceedBudget` (display + the other billers' guard) count committed only. A crash between reserve and finalize leaves a pending row the startup sweep (`sweepStaleReservations`, TTL 15 min) releases. |
| `cards` | 5, 14 | `id`, unique `finding_id` | The drill card and its scheduler state (`ease`, `interval_days`, `repetitions`, `due`, `last_grade`, `suspended`). From v14 those columns are the FSRS-6 state projected back onto the SM-2 shape (`lib/srs.ts`), and a nullable `item_id` links the card to the knowledge item its reviews are evidence for — NULL until E-28 attaches a lemma; a graded linked card appends cued review evidence. |
| `deleted_findings` | 6 | `finding_id` | Tombstone so a deliberately deleted card is not regenerated. Pinning from the Phrasebook clears it. |
| `lessons` | 7 | `id`, unique `pattern_key` | One generated lesson per recurring pattern (`category:<category>`, `lib/lessons/patterns.ts`); `exercises` is JSON. Unique = generated once, re-opened free. |
| `lesson_mastery` | 7 | `pattern_key` | Per-pattern mastery 0..1, updated by the EMA rule in `lib/lessons/mastery.ts`. |
| `item_lessons` | 20 | `item_id` (→ `knowledge_items`, cascade) | One generated micro-lesson per composer-chosen knowledge item (E-32, D-18/D-23): a grammar `rule:<key>` or a lemma `lemma:<lemma>#<POS>`. `kind` ∈ {grammar,vocab}; `register` is the D-23 register it was written in (colto by default); `body` is the validated lesson (intro + typed meaning-first exercises, each with its correct answer + rationale, `glossEn` for vocab) as JSON. The `item_id` PK is the cache key AND the one-generation-one-charge guard — re-opening a lesson is a pure cache hit (no model call, no ledger row), the `lessons.pattern_key` precedent. Stores GENERATED content only; a completed exercise writes cued `evidence` through the E-25 door, never here. |
| `slips` | 11 | `id`, unique `slip_key` | One recurring mistake (E-20): `category`, the representative `correction`, and the deterministic `slip_key` (`category:<normalized correction>`). A materialization of the pure clustering in `lib/slips.ts`, upserted by key so re-analysis of the same findings keeps the same id. State (active/remission/resolved) is computed, never stored. |
| `finding_slips` | 11 | `finding_id` | The finding→slip association: one slip per finding, cascade-deleted with its finding. Rewritten idempotently by `materializeSlips`. |
| `renditions` | 12 | `finding_id` | One contrastive-playback rendition per finding (E-21): `path` (mp3 under `data/renditions/`), `cost_usd` (the actual TTS charge, also ledgered once). The `finding_id` PK is both the render-once cache key and the render lease: the engine claims the row BEFORE the budget check and the provider call (lease-before-spend), so exactly one racing Generate calls the model and bills — the loser makes no call and no ledger row (D-15). An uncommitted claim (budget refusal / failed synthesize) is released so a retry can re-lease. FK cascade on delete; the file is cleaned by the delete route and playback is orphan-safe without it. |
| `knowledge_items` | 14, 16, 17, 18 | `id` | One thing the user is learning (E-25, D-19): a lemma+POS (`lemma:<lemma>#<POS>#<sense>`, `sense_key` NULL until a split is forced), a grammar `rule:<key>`, or a `phone:<symbol>`. `kind` ∈ {lemma,rule,phone}; `freq_rank`/`cefr` are the knowledge edge / banding. From v17 those two REFERENCE columns are SEEDED for the lemma inventory: `freq_rank` is a dense unique rank (1 = most frequent) and `cefr` a coarse band DERIVED FROM RANK (A1…C2 — a license-clean frequency proxy, **not** a measured CEFR level; Kelly's real bands are CC BY-NC and out of the path). `prereqs` is a JSON id array (rules only, the prerequisite DAG); from v18 the E-26b grammar syllabus seeds one `rule:<key>` row per rule with its `prereqs`/`cefr` (the DAG-validated A1→C2 curriculum). The `srs_stability`/`srs_difficulty`/`srs_last_event_at`/`status` (∈ unseen/introduced/learning/known/lapsed) columns are a **derived cache**, rebuildable from `evidence` alone and never the source of truth (`lib/knowledge/derive.ts`). From v16, `recording_attested` (0/1, DEFAULT 0) is another derived-cache column: 1 once the evidence log carries a spontaneous, audio-derived, finding-sourced positive row for this lemma (the user produced it correctly in a recording, E-28), so the daily composer (E-31) excludes it from new-item selection. A lemma id can only exist for a (lemma, POS) morph-it attests (`lib/lexicon/morphit.ts`); the v17/v18 seeds set only the reference columns and never clobber derived/evidence-driven state. |
| `evidence` | 14 | `id`, index `(item_id, created_at)` | **Append-only** (BEFORE UPDATE/DELETE triggers `RAISE(ABORT)`) log of the user's own production (E-25, D-19): `item_id` → `knowledge_items`, `source` ∈ {finding,exercise,tutor,placement}, `source_ref` (TEXT, not an FK — evidence outlives the sessions/findings it cites, the `spend_ledger` precedent), `polarity` 0/1, `mode` ∈ {spontaneous,cued,recognition}, `weight` (the mode weight 1.0/0.6/0.3, ×0.7 when audio-derived), `session_id`. The one source of truth; the `knowledge_items` cache is derived from it and disposable. |
| `spill_queue` | 14 | `id`, index `planned_for` | A knowledge item planned for a day that overflowed today's quota (E-25 creates the table; the daily composer that drains it is v0.5/E-31). Cascade-deleted with its item. |
| `day_ledger` | 19 | `local_day` | One row per LOCAL day the user met their daily goal (E-31, D-24): `local_day` ("YYYY-MM-DD", the local calendar day — timezone stance in `lib/local-day.ts`: a streak day is a local day, never UTC; DB timestamps stay UTC, only this KEY is local), `completed_at` (UTC instant first recorded), `cards_done`/`lessons_done` (the factual figures the one-per-day completion sentence states). The PK makes recording idempotent (INSERT OR IGNORE — a day is never double-counted); the row is AUTHORITATIVE (a completed day cannot be rebuilt from other tables after midnight) and written the moment the goal is first met, so E-38's streak is retroactively true. Figures are written once and never revised. |
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
| 14 | `knowledge_evidence_spill` | `knowledge_items`, append-only `evidence` (+ its no-UPDATE/no-DELETE triggers), `spill_queue`; nullable `item_id` on `cards` — the D-19 knowledge core (E-25) |
| 15 | `spend_reservations` | `state` (pending/committed, DEFAULT committed) + `reserved_at` on `spend_ledger`, and `idx_spend_ledger_pending` — reserve-before-call so the budget cap stays hard when the cascade runs through a concurrency pool (E-27) |
| 16 | `finding_notes_and_recording_attested` | nullable `notes` (enriched-observation JSON) on `findings`; `recording_attested` (0/1, DEFAULT 0, derived) on `knowledge_items` — the E-28 richness dial's enriched deep output and the recording-produced-lemma mark (D-20, D-19) |
| 17 | `lexicon_frequency_seed` | Seeds `knowledge_items` lemma rows from the committed, reduced, attributed asset `lib/lexicon/frequency-lexicon.tsv.gz` (FrequencyWords OpenSubtitles-2018 CC BY-SA, lemmatized through Morph-it! CC BY-SA and morph-it-validated) — sets ONLY `freq_rank` + `cefr` (coarse frequency band), idempotent, never clobbering derived/evidence-driven state (E-26a, D-19). No new table. |
| 18 | `syllabus_grammar_seed` | seeds `knowledge_items` with the E-26b grammar syllabus — one `rule:<key>` row per rule of the DAG-validated, authored A1→C2 curriculum in `lib/syllabus/grammar-it.json`, setting only the reference columns `prereqs` (DAG edges as item ids) and `cefr`, idempotently and without clobbering derived/evidence state (D-19, D-23). No new table. |
| 19 | `day_completion_ledger` | `day_ledger` — the local-day goal-completion ledger (E-31, D-24): one idempotent row per completed local day, written from day one so E-38's streak is retroactively true. Authoritative (not a rebuildable cache). Timezone stance is explicit in `lib/local-day.ts`. |
| 20 | `item_lessons_cache` | `item_lessons` — the generate-once micro-lesson cache, one row per composer-chosen knowledge item (grammar rule or lemma), keyed by `item_id` so re-opening a lesson never re-generates or re-bills (E-32, D-18/D-23). Stores generated content only; the knowledge core is untouched. |

Never edit a shipped migration — add the next one. `tests/migrations.test.ts`
asserts a fresh database reaches the latest version and that re-running is a no-op.
