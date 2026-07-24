import type { Migration } from "./index";

// E-32 Lesson formats v1 (D-18, D-23). The per-item generated-lesson cache: one row
// per composer-chosen knowledge item (a grammar `rule:<key>` or a lemma
// `lemma:<lemma>#<POS>`) whose micro-lesson has been generated. Extracted into its
// own module to keep lib/migrations/index.ts under the 500-line hook.
//
// `item_lessons` — keyed by `item_id` (the knowledge item the lesson teaches). The
//   PRIMARY KEY is the cache key AND the one-generation-one-charge guard: a lesson
//   is generated once, and re-opening it is a pure cache hit — no model call, no
//   ledger row (WO criterion 3, the E-6 `lessons.pattern_key` precedent). `kind`
//   ∈ {grammar,vocab}; `register` records the D-23 register the lesson was written
//   in ("colto" by default); `body` is the validated lesson (intro + typed
//   exercises, each with its correct answer and rationale) as a JSON blob — a
//   self-contained typed list, never queried column-wise, so JSON is the simplest
//   faithful representation (the `lessons.exercises` precedent). FK to
//   `knowledge_items` with ON DELETE CASCADE: an item-lesson is meaningless without
//   its item, and the item is the composer's own selection unit.
//
// Like the E-6 lesson cache, this stores GENERATED content, not source truth — the
// knowledge core (`evidence` → derived `knowledge_items`) is untouched by it, and a
// completed exercise writes evidence through the E-25 door (lib/lessons/item-
// evidence.ts), never here. Additive and shipped-once, like every migration before.
export const itemLessonsMigration: Migration = {
  version: 20,
  name: "item_lessons_cache",
  up: (db) => {
    db.exec(`
      CREATE TABLE item_lessons (
        item_id    TEXT PRIMARY KEY REFERENCES knowledge_items(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL CHECK (kind IN ('grammar','vocab')),
        register   TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
