import type { Migration } from "./index";

// E-47 changes the persisted lesson contract from English teaching prose and
// `glossEn` to target-language-only Italian content. Generated lessons are a
// disposable cache, so preserving a v20 body would be worse than deleting it: an
// old English row could leak on the first read before preparation ran.
//
// No source-of-truth data is touched. Knowledge items, evidence, reviews, progress,
// findings, recordings and spend remain exactly as they were. The new version
// column makes the boundary structural as well as migrational: readers request v2
// explicitly, and every new claim writes v2.
export const italianLessonsMigration: Migration = {
  version: 31,
  name: "italian_lesson_contract",
  up: (db) => {
    db.exec(`
      ALTER TABLE item_lessons
        ADD COLUMN content_version INTEGER NOT NULL DEFAULT 1;

      DELETE FROM item_lessons;
    `);
  },
};
