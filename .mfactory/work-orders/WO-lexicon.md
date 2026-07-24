# WO-lexicon — Italian lexicon import (E-26a, part 1 of the E-26 milestone)

Target repo: immaculatecross/erika · Branch: `feat/lexicon` · **Review tier: Full**
<!-- Full: a schema MIGRATION that seeds the knowledge model. No operator gate (deterministic
     import). E-26's SECOND part — the grammar syllabus (E-26b) — is a separate WO with the
     operator's human-check; do NOT build the syllabus here. -->
<!-- Batch: solo. Builds on E-25 (morph-it validator + knowledge_items). -->

## Objective

Erika learns Italian's vocabulary, so the future daily composer (v0.5) has a real, frequency-ordered inventory of lemmas to draw new items from at the learner's edge. Import a **comprehensive, license-clean** Italian lexicon — well past the roadmap's ~15k floor (the operator's 2026-07-23 directive: **breadth and quality**, comprehensive high-frequency *plus* the advanced/*colto* range an elegant-Italian coach needs) — as `knowledge_items` lemma rows carrying a `freq_rank` (and a coarse license-clean band). Every lemma is validated against E-25's morph-it gate, so nothing fabricated, misspelled, or foreign enters the model. No model calls; deterministic and rebuildable.

## Data sourcing (egress: `git clone` works, `curl` does not — verified)
- **Frequency source:** `git clone --depth 1 https://github.com/hermitdave/FrequencyWords` — the Italian OpenSubtitles list (e.g. `content/2018/it/it_full.txt`, `word count` per line), **CC BY-SA** (attribute; share-alike). Spoken-register, so it needs lemmatization + noise cleanup.
- **Lemmatization (form→lemma):** E-25 committed only the *validation* set (distinct `lemma\tPOS`), not a form→lemma map — so re-`git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer` and build the **form→lemma+POS** map from `master/morph-it_048_utf8.txt` (505k rows) to aggregate wordform frequencies up to lemmas. (Same Morph-it! CC BY-SA data E-25 already attributes.)
- **License discipline (D-19):** ship only license-clean data. **Kelly (CEFR bands), itWaC, spaCy models are CC BY-NC — reference-only, NEVER in the shipped asset or data path.** Frequency-rank banding is the clean substitute for CEFR labels; if you set `cefr`, derive a coarse band from frequency rank, not from an NC source (or leave `cefr` NULL and rely on `freq_rank`).

## Acceptance criteria

1. **Aggregate + clean + validate.** FrequencyWords wordforms are lemmatized through the morph-it form→lemma map and summed to lemma frequencies; **stoplist-cleaned** (drop proper nouns, foreign intrusions, single characters, digit/punctuation tokens, and forms morph-it can't lemmatize); each resulting `(lemma, POS)` is kept **only if `attestsLemma` accepts it** (`lib/lexicon/morphit.ts`). Frequency-rank the survivors (rank 1 = most frequent).
2. **Ambitious, stated breadth.** Seed a **generous** cut — comprehensive, not minimal: aim well past 15k (e.g. all validated lemmas above a stated frequency floor; a corpus this size typically yields ~20–35k clean lemmas incl. the lower-frequency *colto* range). **State the exact count achieved** and the cutoff rule in the PR and an in-asset header. Do not artificially truncate to a round number — include the advanced/literary vocabulary an elegant-Italian coach needs, as far as the clean sources + morph-it validation support.
3. **Seed via migration v17 from a committed, reduced, attributed asset.** Build a compact license-clean asset (e.g. `lib/lexicon/frequency-lexicon.tsv.gz`, one `lemma\tPOS\tfreq_rank[\tband]` per line) via a committed build script (mirror E-25's `scripts/build-morphit-lemmas.ts` pattern; the raw multi-MB sources are NOT committed). Migration **v17** loads it into `knowledge_items` lemma rows setting `freq_rank` (+ band), **idempotently** — `INSERT ... ON CONFLICT(id) DO UPDATE` the freq/band only, so it must **not** clobber E-28's `recording_attested` marks, derived SRS state, or any produced-lemma rows already present. Update the NOTICE/attribution to cover FrequencyWords. `docs/schema.md` updated in the same PR (`tests/migrations.test.ts` enforces).
4. **Tests (D-13 — the real data is the oracle).** A test proves: the seed populates ≥ a stated floor (assert ≥15k) of morph-it-validated lemma rows, frequency-ordered (rank 1 present, ranks unique/dense); a few known high-frequency lemmas (`essere`, `fare`, `dire`) are present at low ranks; a proper noun / non-attested token is absent; re-running the migration/seed is idempotent and preserves a pre-existing `recording_attested` row's mark and SRS state. Build against a throwaway `ERIKA_DATA_DIR`/`ERIKA_DB_PATH`.

## Files and constraints

- **New:** `scripts/build-lexicon.ts` (clone → aggregate → validate → band → emit the asset; not run in CI), `lib/lexicon/frequency-lexicon.tsv.gz` (committed reduced asset), migration `lib/migrations/v17-lexicon.ts` (+ wire in `index.ts`), a bulk seed helper in `lib/knowledge/*` if cleaner than row-by-row. **Changed:** `docs/schema.md`, `lib/lexicon/NOTICE.md` (add FrequencyWords attribution).
- **Contracts that must not break:** `attestsLemma` stays the only lemma gate (E-25); `knowledge_items` derived state (`srs_*`, `status`, `recording_attested`) is a rebuildable cache — the seed sets only reference columns (`freq_rank`, `cefr`) and never overwrites derived/evidence-driven state; the append-only `evidence` log is untouched; `lib/findings-model.ts` authority unaffected. better-sqlite3 + the migrations runner; shipped-once.
- **No model calls, no money.** Deterministic import. Hooks armed; Conventional Commits; 500-line/file (the build script + asset loader may need splitting); no raw source or `data/`/`.env*` committed. License-clean shipped data only (criterion above).

## Out of scope

- **The grammar syllabus** — that is **E-26b** (separate WO, with the operator's human-check). Do not author grammar rules or seed `rule:` items here.
- The daily composer / new-item selection (v0.5, E-31) — E-26a only *populates* the inventory; it does not select from it.
- Sense splitting, CEFR labels from any NC source, pronunciation `phone:` items, or any UI. No new nav.

## Exit report
<!-- Append per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands + the
     achieved lemma count and cutoff) / Tests changed-removed / Risks / Blocker. Verify
     against DISPOSABLE state. If a clean source can't be reached, report `blocked`. -->

RESULT: done
PR:       https://github.com/immaculatecross/erika/pull/43 (branch feat/lexicon)
Changed:
  - scripts/build-lexicon.ts — new provenance generator: clones→lemmatizes→validates→bands→emits the asset (not in CI).
  - lib/lexicon/frequency-lexicon.tsv.gz — new committed, reduced, attributed asset (30,786 rows, 226 KB gz).
  - lib/lexicon/frequency-lexicon.ts — new module-relative asset loader + rankToBand (frequency-derived band).
  - lib/knowledge/seed-lexicon.ts — new bulk seed helper: idempotent upsert of freq_rank+cefr only.
  - lib/migrations/v17-lexicon.ts + index.ts — migration v17 seeds knowledge_items from the asset.
  - lib/lexicon/NOTICE.md — added FrequencyWords (CC BY-SA) attribution + derivation/regeneration notes.
  - docs/schema.md — v17 row, latest version v17, knowledge_items reference-column note.
  - tests/lexicon-seed.test.ts — new; proves criterion-4 properties on the real seeded data.
  - tests/{knowledge,migrations,richness-dial}.test.ts — rescoped 4 pre-seed empty-table assertions.
Verified (against disposable ERIKA_DB_PATH, never data/erika.db):
  - npm run typecheck — clean; npm run lint — no warnings/errors.
  - npm run test — 74 files, 530 passed. npm run build — success (asset traced module-relative).
  - Disposable DB: 30,786 morph-it-validated lemma rows, rank 1 = e#CCONJ, dense 1..30786,
    re-open applies no migrations and count is stable (idempotent); data/ untouched.
  - Achieved lemma count: 30,786 (POS: NOUN 16005, ADJ 7676, VERB 5593, ADV 788, PRON 315,
    DET 225, INTJ 72, ADP 58, CCONJ 51, AUX 3). Cutoff rule: every morph-it-validated (lemma,POS)
    whose aggregated (fractional) OpenSubtitles-2018 frequency >= 2 — a noise-floor, not a
    round-number truncation; ~2x the 15k floor, deep into the colto/literary tail.
Tests changed/removed:
  - tests/knowledge.test.ts: two total-count `.toBe(1)/.toBe(0)` and one `rebuildAllDerived===3`
    assertion rescoped to the ids under test / to before.length — they assumed an empty
    knowledge_items, which the seed now populates. Behaviour under test unchanged.
  - tests/migrations.test.ts: v14 evidence-trigger test now inserts a synthetic id
    ('lemma:__evtest__#NOUN') instead of 'lemma:casa#NOUN' to avoid colliding with a seeded row.
  - tests/richness-dial.test.ts: the "unattested produced lemma dropped" test asserted total
    knowledge_items==0; rescoped to assert the specific fabricated ids are absent (seed now non-empty).
  - No test deleted; no coverage weakened.
Risks:
  - Every fresh DB now runs the ~30k-row seed (~250 ms/open); the full suite stayed at ~38 s wall.
    If a future high-volume test path opens many DBs this could add up — mitigable by a one-time
    fixture DB if it ever bites.
  - The `cefr` band is a coarse FREQUENCY-derived proxy (rankToBand), not a measured CEFR level;
    documented in the asset header, NOTICE.md, schema.md, and code so it is never mistaken for
    Kelly's (CC BY-NC) bands. E-31 should treat freq_rank as the ordering authority.
  - Context-free lemmatization splits an ambiguous wordform's count equally across readings; a
    minor ranking approximation for homographs, acceptable for an edge-ordering signal (no model
    call, deterministic, rebuildable).
