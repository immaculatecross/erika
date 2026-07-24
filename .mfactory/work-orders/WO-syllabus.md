# WO-syllabus — Italian grammar syllabus (E-26b, part 2 of the E-26 milestone)

Target repo: immaculatecross/erika · Branch: `feat/syllabus` · **Review tier: Full**
<!-- Full: a schema MIGRATION seeding the grammar curriculum + quality-critical content
     (operator directive: ambitious breadth + elegant Italian). Dispatcher reviews and
     MERGES on that review, then reports the rule set to the operator (gate WAIVED
     2026-07-23 — async advisory, not a blocker). -->
<!-- PARALLEL BATCH with E-26a (WO-lexicon), each in its own git worktree. Migration versions
     assigned UP FRONT to avoid collision: E-26a = v17 (lexicon), **this milestone = v18**.
     The DISPATCHER performs the consolidated FEATURES/STATE ritual after BOTH merge, and
     resolves the trivial docs/schema.md + lib/migrations/index.ts append-conflict when this
     PR rebases onto master after E-26a's v17 lands. Do NOT edit STATE.md/FEATURES.md. -->

## Objective

Erika gets Italian's grammar as a **prerequisite-ordered curriculum**, so the future composer (v0.5) can introduce rules only once their prerequisites are learned. Author a **comprehensive** grammar syllabus — the operator's 2026-07-23 directive: **the ~180–250-rule figure is a FLOOR, not a target**; cover the important rules across A1→C2 with a genuinely developed **C1/C2 *italiano colto* tail** (D-23) — as versioned JSON with a prerequisite DAG, and seed it as `rule:` `knowledge_items`. This is original, LLM-authored content (you are the author — no model call), structured *after* the *Profilo della lingua italiana* as a reference framework (do not copy its text). Quality and correctness are the point; the operator will review the rule set afterward.

## Acceptance criteria

1. **A comprehensive, correct rule set.** Author well past 250 rules spanning A1→C2, each with: a stable `key` (→ id `rule:<key>`), a CEFR level, a clear English-facing title + a precise one-paragraph description, `prereqs` (ids of rules that must precede it), and ≥1 correct Italian example. Cover the full spine — articles, gender/number, noun/adjective agreement, the tense/mood system (presente→imperfetto→passato prossimo→passato remoto→trapassati→futuri), the **congiuntivo** across tenses and its triggers, condizionale + periodo ipotetico (reale/possibile/irreale), **concordanza dei tempi**, clitics + clitic combinations + ne/ci, si-constructions (passivante/impersonale), comparatives/superlatives, prepositions, relative pronouns, discourse connectives — and a real **colto tail**: passato remoto in narration, congiuntivo trapassato nuance, formal/literary connectives, hypothetical elegance, register and stylistic refinements. Correctness is non-negotiable (operator quality directive) — every rule and example must be right.
2. **Versioned JSON asset + a validated prerequisite DAG.** The syllabus is committed as versioned JSON (e.g. `lib/syllabus/grammar-it.json` with a `version` field). A loader parses it and a validator proves the DAG is **acyclic**, every `prereqs` id **resolves** to a real rule in the set, and the set is **topologically sortable** (a learning order exists). Tests assert all three, plus a spot-check that named rules exist at the right level with the right prereqs (e.g. `congiuntivo-presente` requires `presente-indicativo`; `periodo-ipotetico-irreale` sits in the C-tail with congiuntivo/condizionale prereqs).
3. **Seed `rule:` items via migration v18 (PINNED).** Migration **v18** (`lib/migrations/v18-syllabus.ts`) loads the syllabus JSON into `knowledge_items` as `kind='rule'` rows with `prereqs` (and `cefr`), **idempotently** (`INSERT ... ON CONFLICT(id) DO UPDATE` the `prereqs`/`cefr` only — never clobber derived SRS state / `recording_attested` / evidence). **Use v18, not v17** — v17 is E-26a's lexicon (parallel batch). `docs/schema.md` updated in the same PR with the v18 row (`tests/migrations.test.ts` enforces; the dispatcher will reconcile the append with E-26a's v17 at rebase). A test asserts the seed populates ≥ a stated floor (≥250) of validated rule rows, DAG intact after seeding, and idempotent re-run preserves derived state.
4. **No model calls, no money, license-clean.** The content is your own authored text (Profilo used as a structural reference only, not copied). No external data fetch needed. Verify against a throwaway DB.

## Files and constraints

- **New:** `lib/syllabus/grammar-it.json` (the versioned syllabus), `lib/syllabus/*` (loader + DAG validator — split under the 500-line hook; the JSON itself is data, not a source file, but keep any single source module < 500 lines), migration `lib/migrations/v18-syllabus.ts` (+ wire into `index.ts`). **Changed:** `docs/schema.md` (v18 row).
- **Migration discipline:** **v18 only.** Additive; shipped-once; the seed sets only reference columns (`prereqs`, `cefr`) on `rule:` rows and never touches lemma rows (E-26a) or derived/evidence state (E-25/E-28). `attestsLemma` is irrelevant to rule items (rules aren't lemmas).
- **Contracts that must not break:** `knowledge_items` derived state is a rebuildable cache; the append-only `evidence` log and `lib/findings-model.ts` are untouched; better-sqlite3 + the migrations runner; shipped-once.
- Hooks armed; Conventional Commits; 500-line/file; no `data/`/`.env*` committed. **Do NOT edit STATE.md / FEATURES.md** (the dispatcher owns the consolidated E-26 ritual after both parts merge).

## Out of scope

- The **lexicon** (lemmas/frequency) — that is **E-26a** (parallel), migration v17. Do not seed `lemma:` items or touch the frequency asset.
- The daily composer / rule selection / lesson generation (v0.5, E-31/E-32) — E-26b only *populates* the rule inventory + its DAG; it does not select or teach.
- Pronunciation `phone:` items, UI, new nav, or any model call.

## Exit report
<!-- Append per playbooks/task.md: RESULT / PR / Changed / Verified (exact commands + the
     achieved rule count and CEFR spread) / Tests changed-removed / Risks / Blocker.
     Include a short SUMMARY OF THE RULE SET (counts per CEFR level + the colto-tail rules)
     so the dispatcher can relay it to the operator. Verify against DISPOSABLE state. -->
