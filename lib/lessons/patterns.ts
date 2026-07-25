import { CATEGORIES, isCardable, type Category, type Finding } from "../analysis/findings";

// Pure, explainable pattern derivation (E-6, WO criterion 1). A *pattern* is a
// recurring error grouping in the user's findings; for v1 it is simply a category
// with at least PATTERN_THRESHOLD findings (finer model-clustering is a future
// upgrade). Zero I/O and no model calls, so it is exhaustively unit-testable
// against fixtures at/below/above the threshold. Server- and client-safe.

/** A category needs this many findings to count as a recurring pattern (v1). */
export const PATTERN_THRESHOLD = 3;

export interface Pattern {
  /** Stable key naming the grouping — for v1, `category:<category>`. */
  key: string;
  category: Category;
  /** How many findings fall in this pattern. */
  count: number;
  /** The user's actual findings in this pattern — the lesson's source material. */
  findings: Finding[];
}

/** The pattern key for a category. v1 patterns are per-category; document any change here. */
export function patternKey(category: Category): string {
  return `category:${category}`;
}

/** The category a `category:<category>` key names, or null if malformed/unknown. */
export function parsePatternKey(key: string): Category | null {
  const [prefix, value] = key.split(":", 2);
  if (prefix !== "category") return null;
  return (CATEGORIES as readonly string[]).includes(value) ? (value as Category) : null;
}

/**
 * Derive the recurring-error patterns from a set of findings: group by category,
 * keep only those meeting the threshold, each carrying its example findings. The
 * result is ordered by the canonical CATEGORIES order for a stable, explainable
 * list. A category below the threshold is deliberately *not* a pattern.
 *
 * THE INVARIANT [E-39 §B7]: a pattern is a recurring mistake a TYPED TEXT LESSON can
 * actually teach. An `UNCARDABLE_CATEGORIES` category is never one, and it is excluded
 * HERE — at the single producer — rather than at each consumer, so `lib/plan.ts`'s lesson
 * ranking, `GET /api/lessons/patterns` and `POST /api/lessons/generate` all inherit it
 * from one place and no future consumer has to remember.
 *
 * What this stops: three `pronunciation` findings made a pattern, `/practice/lessons`
 * offered it, and `POST /api/lessons/generate` looked it up here and handed it to
 * `generateLessonForPattern` — a BILLED text-model call whose output is the unanswerable
 * typed exercise `UNCARDABLE_CATEGORIES` was introduced to prevent (RETRO-003). Cards were
 * refused correctly all along; the lesson door was left open because the rule was private
 * to `lib/cards.ts`.
 *
 * What this deliberately does NOT do: pronunciation findings are not hidden anywhere else.
 * They keep their Focus category bar and their letter ranking (those read `findingTallies`,
 * not patterns) and they keep the studio, which is the surface that can practise them.
 * Only the typed-lesson route is closed.
 */
export function derivePatterns(findings: Finding[]): Pattern[] {
  const byCategory = new Map<Category, Finding[]>();
  for (const f of findings) {
    const bucket = byCategory.get(f.category);
    if (bucket) bucket.push(f);
    else byCategory.set(f.category, [f]);
  }
  const patterns: Pattern[] = [];
  for (const category of CATEGORIES) {
    if (!isCardable(category)) continue;
    const group = byCategory.get(category);
    if (!group || group.length < PATTERN_THRESHOLD) continue;
    patterns.push({ key: patternKey(category), category, count: group.length, findings: group });
  }
  return patterns;
}
