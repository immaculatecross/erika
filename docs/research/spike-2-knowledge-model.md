# Spike 2 — Knowledge model: evidence log, FSRS, lexicon, syllabus, placement, composer

2026-07-23 · research spike, no code. Grounded in `STATE.md`, `lib/srs.ts`, `lib/findings-model.ts`, `lib/slips.ts`, `docs/schema.md` (v13).

## Question

Erika's next era derives per-item knowledge states (vocabulary lemmas, grammar rules, pronunciation targets) from an append-only evidence log of the user's own production (recordings, exercises, tutor turns, placement). What scheduler, schema, lexicon, syllabus, placement test, and daily-queue algorithm should carry it?

## Recommendation

1. **Adopt FSRS-6 via `ts-fsrs` (MIT, Node ≥20) as the single scheduler and knowledge-strength scalar.** Its retrievability R(t,S) = (1 + f·t/S)^(−w₂₀) is a probability of recall in [0,1] computable at any moment from a stored (stability, difficulty, last-event) triple — exactly the "strength" scalar, and it works for *any* item kind, not just cards, because FSRS accepts arbitrary elapsed time between events (SM-2 cannot). Migrate existing cards by **state-seeding, not replay**: the `cards` table stores only current SM-2 state (no review log exists), so set S ≈ `interval_days` (SM-2 intervals approximate the 90 %-retention horizon FSRS defines S by), map `ease` 1.3–3.0 linearly onto difficulty 10→1, keep `due`. Ship default FSRS-6 parameters; start logging every review as evidence so the optimizer can personalize the 21 weights later.
2. **Evidence log**: two tables (below), append-only `evidence` + `knowledge_items` with *derived, rebuildable* state columns — the E-20 materialization pattern. Weights: spontaneous 1.0 ≫ cued 0.6 ≫ recognition 0.3. "Known" requires corroboration: ≥2 correct events on ≥2 distinct days, ≥1 spontaneous, none audio-only, no incorrect since. Items are lemma+POS(+sense); sense splits are lazy.
3. **Lexicon**: import **~15k lemmas** from hermitdave's OpenSubtitles-2018 Italian wordform list (CC BY-SA), lemma-aggregated through a **morph-it lookup table** (CC BY-SA 2.0 / LGPL) loaded into SQLite — no Python sidecar. Band by frequency rank (license-clean), optionally cross-checked against Kelly's CEFR bands (CC BY-**NC**-SA — reference only, do not redistribute).
4. **Grammar syllabus**: **LLM-author once (~180–250 rules) + human check**, structured after the *Profilo della lingua italiana* (the official CEFR Reference Level Description for Italian, A1–B2) plus a C1/C2 "italiano colto" tail; store as versioned JSON with prerequisite DAG edges. No open machine-readable inventory exists.
5. **Placement**: a 3–4 min **yes/no frequency-band checklist** (Meara & Buxton 1987; X_Lex design: real words per band + pseudowords; false-alarm guessing correction per Huibregtse, Admiraal & Meara 2002; LexITA validates the format for Italian L2) + optional 60–90 s speaking sample through the existing analysis pipeline. Placement seeds only weak `recognition` evidence — never "known".
6. **Daily composer**: priority cascade — FSRS-due reviews → active slips → unspent findings → new items at the knowledge edge (10 vocab / 3 grammar / 10 pronunciation), overflow persisted to a spill queue drained first tomorrow.

## Options

**Scheduler.** (a) Keep SM-2 — no per-item strength scalar, interval-only, punishes irregular evidence timing. (b) FSRS-6 via `ts-fsrs` — recommended. (c) Hand-rolled half-life regression (Duolingo HLR style) — needs training data Erika doesn't have. Migration options: replay logs (impossible — `cards` has no `review_log`), reset to fresh (loses a year of state), **seed from SM-2 columns** (recommended; this is what Anki does when FSRS is enabled without usable history).

**Lexicon sources.** SUBTLEX-IT (OSF): research-grade subtitle wordform frequencies, CC BY-SA-like but *wordforms*, no lemma ranking. COLFIS: lemmatized but small, written-register, 1990s, research-use license. itWaC/WaCky lemma lists: huge and already lemmatized but CC BY-**NC**-SA. Kelly Italian (~9k items, CEFR-banded A1–C2): best banding, CC BY-**NC**-SA 2.0. hermitdave FrequencyWords (OpenSubtitles 2016/2018): CC BY-SA, spoken-register, needs lemmatization + noise cleanup — recommended base. Lemmatization: simplemma is MIT but **Python-only** (no npm port); spaCy `it_core_news_*` has the best trainable lemmatizer but the models are **CC BY-NC-SA 3.0** and force a sidecar service; **morph-it** (~500k form→lemma+POS rows, CC BY-SA 2.0/LGPL dual) is a pure data table that drops straight into better-sqlite3 — recommended, with the analysis LLM emitting lemma+POS per finding and morph-it acting as the canonical-id validator.

**Syllabus.** Profilo della lingua italiana (Spinelli & Parizzi 2010, La Nuova Italia + CD-ROM; CVCL Perugia) — authoritative but copyrighted print, usable as authoring reference. Lo Duca's *Sillabo di italiano L2* — same. Open coursebooks: nothing with prerequisite ordering. LLM-authored + human-checked is the only importable path.

**Placement scoring.** Raw hit rate (inflated by yes-bias); h−f/(1−f) correction; **Δm / ISDT correction** (Huibregtse et al. 2002 — separates guessing from response style; recommended); LexTALE-style `%words − 2×%false-alarms` (what LexITA uses; simpler, acceptable fallback).

## Proposed schema (E-24, migration v14)

```sql
CREATE TABLE knowledge_items (
  id          TEXT PRIMARY KEY,   -- 'lemma:pesca#N#2' | 'rule:congiuntivo-imperfetto' | 'phone:/ʎ/'
  kind        TEXT NOT NULL CHECK (kind IN ('lemma','rule','phone')),
  lemma       TEXT, pos TEXT, sense_key TEXT,      -- lemma kind only; sense_key NULL until a split is forced
  freq_rank   INTEGER, cefr TEXT,                  -- the knowledge edge / banding
  prereqs     TEXT,                                -- JSON array of item ids (rules only, DAG)
  -- derived cache, rebuildable from evidence (never the source of truth):
  srs_stability REAL, srs_difficulty REAL, srs_last_event_at TEXT,
  status      TEXT NOT NULL DEFAULT 'unseen'
              CHECK (status IN ('unseen','introduced','learning','known','lapsed'))
);
CREATE TABLE evidence (            -- append-only: no UPDATE, no DELETE
  id          TEXT PRIMARY KEY,
  item_id     TEXT NOT NULL REFERENCES knowledge_items(id),
  source      TEXT NOT NULL CHECK (source IN ('finding','exercise','tutor','placement')),
  source_ref  TEXT,                -- finding id / exercise id; TEXT, not FK — evidence outlives sessions (spend_ledger precedent)
  polarity    INTEGER NOT NULL CHECK (polarity IN (0,1)),
  mode        TEXT NOT NULL CHECK (mode IN ('spontaneous','cued','recognition')),
  weight      REAL NOT NULL,       -- 1.0 / 0.6 / 0.3 by mode; ×0.7 confidence discount when audio-derived
  session_id  TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_evidence_item ON evidence(item_id, created_at);
```

Rules: findings→evidence bridging reads **only** through `INCLUDED_FINDING_SCOPE` (E-17). Evidence→FSRS grade mapping: incorrect→Again; correct cued→Good; correct spontaneous→Easy; recognition-only evidence updates status but not the FSRS state (too weak to be a "review"). Homographs: id = lemma+POS(+sense ordinal); import assigns the dominant sense implicitly (sense_key NULL); a finding or exercise that disambiguates (*pesca* fruit vs. fishing; *ancora* adv vs. noun) forces a sense split, and sense-unknown evidence rolls up at lemma+POS. Corroboration before `known` as in Recommendation §2 — one noisy audio-positive can never flip status alone.

## Evidence

- FSRS-6 spec (DSR model, power forgetting curve, 21 parameters, initial S/D from first rating): https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- `ts-fsrs` (MIT, FSRS-6, `createEmptyCard`/`next`/`repeat`, retrievability accessor): https://github.com/open-spaced-repetition/ts-fsrs · https://www.npmjs.com/package/ts-fsrs
- SM-2→FSRS conversion practice (seed from interval/ease; default params until history suffices): https://kuroahna.github.io/anki_srs_kai/guide/fsrsToSM2.html · https://faqs.ankiweb.net/what-spaced-repetition-algorithm
- SUBTLEX-IT (OSF): https://osf.io/zg7sc/ · hermitdave FrequencyWords (CC BY-SA): https://github.com/hermitdave/FrequencyWords · WaCky/itWaC lists (CC BY-NC-SA): https://wacky.sslmit.unibo.it/doku.php?id=frequency_lists · Kelly (CC BY-NC-SA 2.0, CEFR-banded): https://ssharoff.github.io/kelly/ · morph-it (CC BY-SA 2.0 / LGPL): https://www.docs.sslmit.unibo.it/doku.php?id=resources:morph-it · simplemma (MIT, Python-only): https://github.com/adbar/simplemma · spaCy Italian models CC BY-NC-SA 3.0: https://huggingface.co/spacy/it_core_news_sm
- Profilo della lingua italiana (CEFR RLD for Italian, A1–B2): https://www.unistrapg.it/en/conoscere-l-ateneo/organi-e-strutture/center-for-language-evaluation-and-certification/progetti-cvcl/il-profilo-della-lingua-italiana-livelli-del-qcer-a1-a2-b1-b2
- Yes/no methodology: Meara & Buxton 1987; X_Lex (Meara & Milton 2003, 20 words × 5 bands + 20 pseudowords); guessing/response-style correction: Huibregtse, Admiraal & Meara 2002, https://www.researchgate.net/publication/279473499 ; LexITA (validated Italian yes/no, Applied Linguistics 2021): https://eric.ed.gov/?id=EJ1300272

## Daily composer sketch

```
compose(day, quotas = {vocab:10, rules:3, phones:10, reviewCap:~60}):
 1. drain spill_queue rows with planned_for ≤ day
 2. reviews: items with R(now) < requestRetention (FSRS-due), worst-R first, up to reviewCap
 3. active slips (lib/slips.ts state='active') lacking a due item today → inject their items
 4. unspent findings: included findings with no evidence row → bridge to evidence + enqueue their items
 5. new material at the edge, per kind, until quota:
      lemma: lowest freq_rank with status='unseen' (skip placement-presumed-known)
      rule:  all prereqs status ∈ {learning, known}
      phone: L1-contrast priority list, pronunciation findings first
 6. interleave (2–3 reviews per new item); anything selected-but-unserved → spill_queue(day+1)
```

Deterministic and pure-core-testable (the `lib/focus.ts` / `lib/slips.ts` split); no model calls.

## Risks & unknowns

- **FSRS fit to implicit evidence.** FSRS was trained on flashcard reviews; production evidence is noisier and not self-paced. Mitigation: corroboration gate, discrete grade mapping, recognition excluded from FSRS updates. Unknown until real data: whether default parameters over/under-schedule; revisit with the optimizer after ~1k logged reviews.
- **Seeded states are approximations** — S≈interval is coarse for high-ease cards; harmless (FSRS self-corrects within 2–3 reviews).
- **NC licenses** (Kelly, itWaC, spaCy models) are landmines if Erika is ever productized — keep them out of the shipped data path; frequency-rank banding is the clean substitute for Kelly's CEFR labels.
- **Subtitle-register bias vs. "italiano colto"** — OpenSubtitles ranks colloquial speech high; the colto tail (passato remoto, formal connectives) needs a curated supplement, plausibly LLM-authored alongside the grammar syllabus.
- **Lemma noise**: morph-it lookup is context-free (ambiguous forms need the LLM's POS call); subtitle lists carry proper nouns/foreign intrusions — import needs a stoplist pass.
- **Sense-split policy** is heuristic; over-splitting fragments evidence, under-splitting merges homonyms. Lazy splitting bounds the damage.
- COLFIS/NVdB licenses unverified in depth; not on the recommended path.

## Milestone implications

- **E-24 knowledge core**: migration **v14** (`knowledge_items`, `evidence`, `spill_queue`, FSRS columns or a `review_log`), `lib/knowledge.ts` pure core + DB glue, SM-2→FSRS seeding, `docs/schema.md` in the same PR (ritual). `lib/srs.ts` becomes a thin `ts-fsrs` wrapper; keep the pure-function shape.
- **E-25 lexicon import**: seed script (morph-it + FrequencyWords under `data/` or a bundled asset ≤ license terms), ~15k lemma rows.
- **E-26 grammar syllabus seed**: LLM-authored JSON, human-checked PR review is the gate; prereq DAG validated in tests.
- **E-27 placement**: yes/no test UI + Δm scoring (pure, unit-tested) + optional speaking sample reusing capture→analysis.
- **E-28 daily composer**: cascade above; slips-first honors E-20; findings bridge honors E-17. Every module respects the 500-line hook — the composer will want the focus/slips two-file split from day one.
