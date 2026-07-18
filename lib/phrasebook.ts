// Client-safe view model + pure search/filter for the Phrasebook (E-9, v0.2
// milestone 2), mirroring the split in lib/analysis-view.ts / lib/cards-view.ts:
// no Node/better-sqlite3 imports live here, so the /phrasebook page, its filter,
// and the read route share one entry shape. The server route reduces a full
// lib/analysis/findings.ts Finding (plus which findings currently carry a card)
// into these entries; the page filters them in the browser with `filterEntries`.
//
// The Phrasebook is the *full library* of recasts built from every finding; the
// flashcard deck is a curated subset (E-5b lets you delete cards). So an entry's
// `inDeck` is simply whether a card row exists for its finding right now.

import type { Finding, Category, Severity } from "./analysis/findings";

export type { Category, Severity } from "./analysis/findings";
export { CATEGORY_ORDER } from "./analysis-view";

/** One recast in the library: what you said beside the native correction. */
export interface PhrasebookEntry {
  findingId: string;
  sessionId: string;
  /** What you said. */
  quote: string;
  /** How a native recasts it. */
  correction: string;
  explanation: string;
  category: Category;
  severity: Severity;
  startMs: number;
  /** Whether a flashcard currently exists for this finding (already pinned). */
  inDeck: boolean;
}

/** "all" means no category constraint; otherwise the one category to show. */
export type CategoryFilter = Category | "all";

/** The search state: a free-text query and a category constraint. */
export interface PhrasebookFilter {
  query: string;
  category: CategoryFilter;
}

/** Build one entry from a finding and whether its finding is already in the deck. */
export function toEntry(finding: Finding, inDeck: boolean): PhrasebookEntry {
  return {
    findingId: finding.id,
    sessionId: finding.sessionId,
    quote: finding.quote,
    correction: finding.correction,
    explanation: finding.explanation,
    category: finding.category,
    severity: finding.severity,
    startMs: finding.startMs,
    inDeck,
  };
}

/** Build the library from every finding, marking which are already pinned. */
export function buildEntries(findings: readonly Finding[], inDeck: ReadonlySet<string>): PhrasebookEntry[] {
  return findings.map((f) => toEntry(f, inDeck.has(f.id)));
}

/**
 * Narrow the library by a free-text query (matched case-insensitively against
 * the quote, the correction, and the explanation) AND a category — the two are
 * an intersection. A blank/whitespace-only query matches everything (within the
 * chosen category); "all" imposes no category constraint. Pure — no DB, no model.
 */
export function filterEntries(
  entries: readonly PhrasebookEntry[],
  filter: PhrasebookFilter,
): PhrasebookEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.category !== "all" && e.category !== filter.category) return false;
    if (q === "") return true;
    return (
      e.quote.toLowerCase().includes(q) ||
      e.correction.toLowerCase().includes(q) ||
      e.explanation.toLowerCase().includes(q)
    );
  });
}
