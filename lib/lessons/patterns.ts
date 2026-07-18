import { CATEGORIES, type Category, type Finding } from "../analysis/findings";

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
    const group = byCategory.get(category);
    if (!group || group.length < PATTERN_THRESHOLD) continue;
    patterns.push({ key: patternKey(category), category, count: group.length, findings: group });
  }
  return patterns;
}
