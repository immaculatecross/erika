import type { Db } from "../db";
import {
  authoredLessonFor,
  getItemLesson,
  ITEM_LESSON_CONTENT_VERSION,
} from "./item-lessons";
import { assertItalianLesson } from "./italian-language";
import type { ItemLesson } from "./item-lessons-view";

/**
 * The complete lesson the read-only session boundary can serve now.
 *
 * A completed cache wins. Otherwise the authored Italian backbone is an in-memory
 * safety net, including vocabulary's same-edge grammar substitution. This performs
 * no model call, spend reservation, or cache write.
 */
export function servableItemLesson(db: Db, itemId: string): ItemLesson | null {
  const cached = getItemLesson(db, itemId);
  if (cached) return cached;
  try {
    return authoredLessonFor(db, itemId);
  } catch {
    return null;
  }
}

/**
 * Freeze the body Start promises for this selected item.
 *
 * If generation already completed, its cache body is the pin. Otherwise Start
 * atomically fills the missing/empty row with authored Italian. An active owner may
 * still resolve and finalize its accepted-call spend, but `body = ''` and claim-token
 * ownership prevent it from replacing this body.
 */
export function pinServableItemLesson(db: Db, itemId: string): ItemLesson | null {
  return db.transaction(() => {
    const cached = getItemLesson(db, itemId);
    if (cached) return cached;

    let authored: ItemLesson;
    try {
      authored = authoredLessonFor(db, itemId);
    } catch {
      return null;
    }
    assertItalianLesson(authored);
    const body = JSON.stringify({
      itemId: authored.itemId,
      intro: authored.intro,
      definition: authored.definition,
      exercises: authored.exercises,
      examples: authored.examples,
      newWords: authored.newWords,
      deterministic: authored.deterministic,
    });
    db.prepare(
      "INSERT INTO item_lessons (item_id, kind, register, body, content_version, claim_token) " +
        "VALUES (?, ?, ?, ?, ?, NULL) " +
        "ON CONFLICT(item_id) DO UPDATE SET kind = excluded.kind, register = excluded.register, " +
        "body = excluded.body, content_version = excluded.content_version, claim_token = NULL " +
        "WHERE item_lessons.body = '' OR item_lessons.content_version <> excluded.content_version",
    ).run(itemId, authored.kind, authored.register, body, ITEM_LESSON_CONTENT_VERSION);
    return getItemLesson(db, itemId);
  })();
}
