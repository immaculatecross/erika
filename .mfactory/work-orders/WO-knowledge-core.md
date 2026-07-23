# WO-knowledge-core — Knowledge core: evidence log & FSRS-6 (E-25)

Target repo: immaculatecross/erika · Branch: `feat/knowledge-core` · **Review tier: Full**
<!-- Full is mandatory: a schema MIGRATION, a scheduling-algorithm swap seeding real card
     state, and a new findings→evidence bridge on the analysis correctness path. Do not lower it. -->
<!-- Batch: solo (this is the shared knowledge foundation E-26/E-28/v0.5 build on — it runs alone). -->

## Objective

Erika gains the knowledge model D-19 ratified: an **append-only `evidence` log** of the user's own production (findings today; exercises/tutor/placement later), from which **per-item knowledge state is derived and fully rebuildable** — never stored as source truth (the E-20 materialization pattern). Knowledge items are lemma+POS (lazy sense splits), grammar rule, or phone; their strength is a single FSRS-6 retrievability scalar. Scheduling moves **SM-2 → FSRS-6** everywhere via `ts-fsrs`, with the existing flashcards **state-seeded** (no review history exists to replay) and every review from now on logged as evidence. A **morph-it** canonical-lemma validator lands so no evidence row — and no knowledge item — can ever mint an unvalidated lemma ID. When this is done the plumbing exists for E-26 (lexicon/syllabus), E-28 (the deep pass writing validated production evidence) and v0.5's daily composer, but there is **no new user-facing surface** yet — this is infrastructure, and the flashcard drill keeps working exactly as before (now on FSRS).

## Environment note — data sourcing (verified by the dispatcher)

The sandbox egress proxy **blocks `curl`/`wget` to non-allowlisted hosts (403)** but **permits `git clone` of public GitHub repos** (and the npm registry). Source external data via git clone, not curl.
- **`ts-fsrs`** (MIT, FSRS-6): install from npm normally.
- **morph-it** (the Italian morphological lexicon): `git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer` — file `master/morph-it_048_utf8.txt`, **505,074 rows**, tab-separated `form⟶lemma⟶features` (e.g. `abbandoni⟶abbandono⟶NOUN-M:p`, `a-storico⟶ADJ:pos+m+s`). The underlying Morph-it! data is free/CC-BY-SA (Baroni & Zanchetta, Univ. Bologna/Trento) — **redistributable with attribution + share-alike**; include a NOTICE/attribution file. Do NOT commit the raw 19 MB file; reduce it (see criterion 2).

## Acceptance criteria

1. **Migration v14 — the knowledge schema.** One migration adds `knowledge_items`, an append-only `evidence` table (no UPDATE/DELETE of evidence rows), and a `spill_queue`, following the spike-2 shape (adapt names/columns as the code demands, but keep the intent): `knowledge_items` = id (`lemma:…#POS#sense` | `rule:…` | `phone:…`), kind∈{lemma,rule,phone}, lemma/pos/sense_key (lazy — NULL until a split is forced), freq_rank/cefr, prereqs (JSON, rules only), plus a **derived cache** (`srs_stability`, `srs_difficulty`, `srs_last_event_at`, `status`∈{unseen,introduced,learning,known,lapsed}) that is rebuildable and never source truth; `evidence` = id, item_id→knowledge_items, source∈{finding,exercise,tutor,placement}, source_ref (TEXT, not FK — evidence outlives sessions, the `spend_ledger` precedent), polarity∈{0,1}, mode∈{spontaneous,cued,recognition}, weight REAL, session_id, created_at; an index on (item_id, created_at). **`docs/schema.md` is updated in the same PR** (the migration ritual — `tests/migrations.test.ts` fails otherwise). Migrations are shipped-once (the runner reads `_migrations` on disk); verify against a throwaway DB only.
2. **morph-it canonical-lemma validator.** A validator lands so **no evidence row and no `knowledge_items` lemma can be created with a (lemma, POS) that morph-it does not attest.** Reduce the 505k form-rows to the distinct **(lemma, POS)** set (morph-it POS tags mapped to the item's POS scheme; punctuation/`SENT`/`PON` and non-word rows dropped), commit that compact set as a **license-clean asset outside `data/`** (e.g. `lib/lexicon/morphit-lemmas.<compact>` — gzipped/newline; expect well under the raw 19 MB) with an attribution NOTICE, and a loader that populates a reference lookup (a SQLite table or an in-memory set built at first use — your call) usable in **tests and CI without network**. A test asserts a real morph-it lemma validates and a fabricated one (`"zzzfoo"`/wrong-POS) is rejected, and that the evidence/knowledge-item write path refuses the unvalidated ID. (This is a deterministic lookup of real data, not a tuned threshold — the real file is its own oracle; handle its encoding/multiword/quirk rows, D-13.)
3. **SM-2 → FSRS-6.** `lib/srs.ts` becomes a thin **`ts-fsrs`** wrapper that keeps its current pure-function shape and the export names `lib/cards.ts` consumes (so the drill path changes behavior, not its call sites); retrievability `R(t,S)` is the one strength scalar. Existing cards are **state-seeded, not replayed** (none has a review log): `S ≈ interval_days`, `ease` 1.3–3.0 mapped linearly onto FSRS difficulty 10→1, `due` kept. Ship default FSRS-6 parameters (note in-code they are **uncalibrated** — optimized later once reviews accrue; FSRS self-corrects within a few reviews, the truthful degradation path — D-13). Grading a card still schedules it correctly end to end **and now writes a review `evidence` row** (mode `cued`; grade→polarity per §4). A test asserts a seeded card schedules sanely and that grading appends evidence.
4. **Findings → evidence, only through the E-17 scope.** Bridging findings to evidence reads **exclusively** through `lib/findings-model.ts`'s included-finding scope (E-17, CLAUDE.md rule — no competing gate). Each bridged finding writes evidence on a **validated** item id with `mode` (spontaneous 1.0 / cued 0.6 / recognition 0.3) and `weight` (×0.7 when audio-derived) and `polarity`. Evidence→FSRS grade mapping (spike-2): incorrect→Again; correct+cued→Good; correct+spontaneous→Easy; **recognition-only evidence updates `status` but is too weak to be an FSRS review** (does not touch the S/D/last-event triple). A test covers a finding bridging to a correctly-weighted evidence row and the mapping.
5. **"Known" needs corroboration (D-19).** `status` reaches `known` only with **≥2 correct events on ≥2 distinct days, ≥1 spontaneous, none audio-only, and none incorrect since** — one noisy audio-positive can never flip status alone. A test constructs evidence sequences that do and don't satisfy the gate.
6. **Derived state rebuilds identically from evidence alone.** A test wipes every derived column (`srs_*`, `status`) and rebuilds it from the append-only `evidence` log, asserting the rebuilt `knowledge_items` state is **identical** to the incrementally-maintained state — proving evidence is the source of truth and the cache is disposable.

## Files and constraints

- **New:** `lib/knowledge.ts` — pure core + DB glue; **split under the 500-line hook** if needed (e.g. `lib/knowledge/evidence.ts`, `lib/knowledge/derive.ts`, `lib/knowledge/items.ts`). The morph-it asset + loader (`lib/lexicon/…`). Migration v14 inside `lib/migrations/index.ts` (follow the existing runner's shape). Attribution NOTICE for morph-it.
- **Changed:** `lib/srs.ts` (→ `ts-fsrs` wrapper, same pure shape + export names), `lib/cards.ts` (persist FSRS state, seed existing cards, append review evidence). `docs/schema.md` (v14). `package.json` (+ `ts-fsrs`).
- **Contracts that must not break:** `lib/findings-model.ts` stays the *only* findings gate (E-17). The flashcard drill (`/practice` drill, grading, keyboard shortcuts) behaves the same to the user. `createSession`/ingest/analysis untouched. better-sqlite3 + the migrations runner. DESIGN.md holds for any (there should be little/no) visible copy.
- **D-13:** the morph-it lookup is deterministic over real data — the real file is the oracle; the FSRS seed mapping is an explicit heuristic — mark it uncalibrated with the truthful self-correcting degradation. External-input isolation: a malformed morph-it row is skipped, never fatal to the load.
- **Disposable state:** verify against a throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`, **never** `data/erika.db`. Hooks armed (`git config core.hooksPath .mfactory/hooks`); Conventional Commits; no `.env*`/`data/` committed. No `OPENAI_API_KEY` needed — this milestone makes **zero model calls** (findings already exist; the deep pass emitting lemmas is E-28).

## Out of scope

- The **~15k frequency lexicon import** (FrequencyWords) and the **grammar syllabus** — those are **E-26**. E-25 lands morph-it as the *validator* only; it does not populate the lemma inventory from frequency data.
- The **deep pass emitting production lemmas / the richness dial** (E-28), the **daily composer / spill drain** logic and any Learn-tab UI (v0.5, E-31+) — E-25 creates `spill_queue` as a table but wires no composer.
- Placement (E-35), lesson formats (E-32), tutor (E-34).
- Any new nav item, route, or product surface. FSRS parameter optimization (later, once reviews accrue).
- Touching the ingest/analysis pipeline or spend paths (those are E-27/E-28).

## Exit report
<!-- Append here per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands) /
     Tests changed-removed (read each as a spec — D-14) / Risks / Blocker. Run lint + typecheck
     + test + the full build before pushing. If morph-it cannot be sourced or a criterion is
     untestable, report `blocked` with specifics — do not fake validation or skip a test. -->

RESULT: done
PR:       feat/knowledge-core → master (see PR link in exit message)
Changed:
  - Migration v14 (`lib/migrations/v14-knowledge.ts`, wired in `lib/migrations/index.ts`
    which was split to stay under the 500-line hook): `knowledge_items` (derived,
    rebuildable SRS cache), append-only `evidence` (BEFORE UPDATE/DELETE triggers
    RAISE(ABORT)), `spill_queue` (table only — composer is v0.5), and a nullable
    `cards.item_id` FK. `docs/schema.md` updated in the same PR (v14, three tables +
    the cards note + the migration-history row).
  - morph-it validator: `lib/lexicon/pos.ts` (the coarse UD-style POS scheme +
    morph-it tag→POS map), `lib/lexicon/morphit.ts` (loader + `attestsLemma`),
    `lib/lexicon/morphit-lemmas.tsv.gz` (the committed, license-clean reduced asset —
    37,701 distinct (lemma, POS) pairs, 128 KB, from 505,074 raw rows; 86 malformed/
    non-word rows skipped), `lib/lexicon/NOTICE.md` (CC BY-SA attribution + share-alike),
    `scripts/build-morphit-lemmas.ts` (the provenance generator; raw 19 MB file NOT committed).
  - `lib/srs.ts`: SM-2 core replaced by a thin `ts-fsrs` (FSRS-6) wrapper; same
    `SrsState → Grade → SrsResult` shape and export names, so `lib/cards.ts` call
    sites are unchanged. Existing cards are state-seeded each grade (S≈interval,
    ease 1.3–3.0 ↔ difficulty 10→1, due kept); adds `retrievability(S,t)` — the one
    strength scalar. Default FSRS-6 params, marked uncalibrated in-code (D-13).
  - `lib/knowledge/` — `types.ts` (mode weights, audio discount), `items.ts` (the
    morph-it gate: only an attested lemma mints an item), `evidence.ts`
    (`recordEvidence` append + re-derive; `bridgeFinding` reads ONLY through
    `getIncludedFinding` — E-17), `derive.ts` (the FSRS fold over real elapsed time +
    the D-19 status gate; `rebuildAllDerived`), `index.ts` (barrel).
  - `lib/cards.ts`: `gradeCard` appends a cued review evidence row when the card is
    linked to a knowledge item (grade→polarity), inside one transaction with the
    schedule update; unlinked cards (all until E-28) log nothing.
Verified: (throwaway ERIKA_DB_PATH temp dirs only — never data/erika.db, which does not exist)
  - `npm run typecheck` → clean.
  - `npm run lint` → No ESLint warnings or errors.
  - `npm run test` → 68 files, 479 tests passing (incl. the new knowledge/lexicon
    suites, v14 migration + append-only trigger assertions, and the linked-card
    review-evidence + rebuild-identical tests).
  - `npm run build` → Compiled successfully; 14 static pages generated.
  - Exercised the changed drill path: `gradeCard`/grade-route tests seed a card,
    grade it end-to-end (FSRS schedules it out of the due queue), and confirm the
    evidence append; the derivation test wipes every `srs_*`/`status` column and
    rebuilds them identically from the evidence log alone.
Tests changed/removed:
  - `tests/srs.test.ts` — rewritten: it asserted exact SM-2 numbers (ease deltas,
    interval 1 on first pass) that FSRS does not reproduce. New spec keeps the
    drill-facing invariants (Again resets + returns this session, a pass schedules
    ≥1 day out, Easy > Good > Hard, ease stays in bounds) and adds the seed-mapping
    round-trip + retrievability curve. No coverage dropped.
  - `tests/cards.test.ts` / `tests/cards-route.test.ts` — one exact-interval
    assertion each (`intervalDays === 1` on first Good) relaxed to the drill/route
    contract (`>= 1`, and the card leaves the due queue). FSRS's first-Good interval
    is 3 days, not 1; the intent (a pass advances the card) is preserved and still
    asserted. Nothing else changed or removed.
Risks:
  - FSRS parameters are the uncalibrated defaults (per spec) — scheduling intervals
    will shift once the optimizer runs on accrued reviews; FSRS self-corrects, so no
    action needed now (D-13 degradation path). Card FSRS state is projected onto the
    integer `interval_days` column, so between reviews stability is quantised to whole
    days (same granularity SM-2 used); the un-quantised triple lives on
    `knowledge_items`, where per-event precision matters.
  - Audio-derived-ness of an evidence row is recovered from (mode, weight) rather than
    a dedicated column (the spike-2 schema has none) — safe because the ×0.7 discounted
    weights never collide with the undiscounted ones; if a future caller passes a
    non-canonical weight this inference would misread, so `recordEvidence` computes
    weight itself and never takes it on trust.
  - The finding→item link (`cards.item_id`, and the lemma a finding carries) is wired
    but unpopulated: E-25 makes zero model calls, so in production no card is linked and
    no findings are bridged yet — that is E-28's job. The plumbing and its tests exist.
Blocker: none.
