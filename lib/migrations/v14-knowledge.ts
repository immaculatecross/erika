import type { Migration } from "./index";

// E-25 Knowledge core (D-19): the append-only evidence log and the per-item
// knowledge state derived from it. Extracted into its own module to keep
// lib/migrations/index.ts under the 500-line hook — the runner appends it to the
// ordered list. Three tables + one card link.
//
// `knowledge_items` — one row per thing the user is learning: a lemma+POS
//   (`lemma:<lemma>#<POS>#<sense>`, sense_key NULL until a split is forced), a
//   grammar rule (`rule:<key>`), or a phone (`phone:<symbol>`). `freq_rank`/`cefr`
//   are the knowledge edge / banding (populated by E-26; NULL here). `prereqs` is a
//   JSON id array (rules only, the prerequisite DAG). The `srs_*` triple and
//   `status` are a DERIVED CACHE — rebuildable from `evidence` alone and never the
//   source of truth (the E-20 materialization pattern): `status` is 'unseen' until
//   evidence arrives.
// `evidence` — APPEND-ONLY (BEFORE UPDATE/DELETE triggers RAISE(ABORT)): one row
//   per observed act of the user's production. `item_id` FKs an item; `source_ref`
//   is TEXT, not an FK — evidence outlives the sessions and findings it cites (the
//   spend_ledger precedent). `polarity` 0/1, `mode` spontaneous/cued/recognition,
//   `weight` (the mode weight, ×0.7 when audio-derived). Indexed by
//   (item_id, created_at) for the per-item fold.
// `spill_queue` — created here (the composer that drains it is v0.5/E-31); a
//   knowledge item planned for a day that overflowed today's quota.
// `cards.item_id` — nullable link from a drill card to the knowledge item its
//   review is evidence for. NULL until the deep pass (E-28) attaches lemmas to
//   findings; a graded linked card appends cued review evidence (lib/cards.ts).
export const knowledgeMigration: Migration = {
  version: 14,
  name: "knowledge_evidence_spill",
  up: (db) => {
    db.exec(`
      CREATE TABLE knowledge_items (
        id                TEXT PRIMARY KEY,
        kind              TEXT NOT NULL CHECK (kind IN ('lemma','rule','phone')),
        lemma             TEXT,
        pos               TEXT,
        sense_key         TEXT,
        freq_rank         INTEGER,
        cefr              TEXT,
        prereqs           TEXT,
        srs_stability     REAL,
        srs_difficulty    REAL,
        srs_last_event_at TEXT,
        status            TEXT NOT NULL DEFAULT 'unseen'
                            CHECK (status IN ('unseen','introduced','learning','known','lapsed')),
        created_at        TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE evidence (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES knowledge_items(id),
        source     TEXT NOT NULL CHECK (source IN ('finding','exercise','tutor','placement')),
        source_ref TEXT,
        polarity   INTEGER NOT NULL CHECK (polarity IN (0,1)),
        mode       TEXT NOT NULL CHECK (mode IN ('spontaneous','cued','recognition')),
        weight     REAL NOT NULL,
        session_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_evidence_item ON evidence(item_id, created_at);

      -- Append-only: evidence is the source of truth, so it is never rewritten
      -- or removed (the derived cache is what gets rebuilt).
      CREATE TRIGGER evidence_no_update BEFORE UPDATE ON evidence
        BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;
      CREATE TRIGGER evidence_no_delete BEFORE DELETE ON evidence
        BEGIN SELECT RAISE(ABORT, 'evidence is append-only'); END;

      CREATE TABLE spill_queue (
        id          TEXT PRIMARY KEY,
        item_id     TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        planned_for TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_spill_queue_planned ON spill_queue(planned_for);

      ALTER TABLE cards ADD COLUMN item_id TEXT REFERENCES knowledge_items(id);
    `);
  },
};
