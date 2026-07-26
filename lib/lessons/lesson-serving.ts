import type { Db } from "../db";
import { authoredLessonFor, getItemLesson } from "./item-lessons";
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
