// Client-safe view model + pure timeline build/filter for the Speech archive
// (E-11, v0.2 milestone 3), mirroring the split in lib/phrasebook.ts: no Node/
// better-sqlite3 imports live here, so the /archive page, its filters, and the
// read route share one entry shape. The server route reduces findings enriched
// with their session date (lib/analysis/findings.listAllFindingsWithSession)
// into these entries; the page filters and groups them in the browser.
//
// The archive is your speaking life in time order — every analyzed moment, newest
// session first, each moment linking back to its audio. "Transcripts exist only as
// analysis byproducts": the finding quotes are the record, there is no separate one.

import type { Category, Severity } from "./analysis/findings";

export type { Category, Severity } from "./analysis/findings";
export { CATEGORY_ORDER } from "./analysis-view";

// Severity display order (high → low), defined here — client-safe — so this module
// and the /archive page never import a runtime value from lib/analysis/findings.ts
// (which pulls node:crypto into the client bundle). Mirrors that file's SEVERITIES.
export const SEVERITY_ORDER = ["high", "medium", "low"] as const satisfies readonly Severity[];

/** One analyzed moment: what you said, when, and where to hear it. */
export interface ArchiveEntry {
  findingId: string;
  sessionId: string;
  /** The owning session's capture date (SQLite UTC) — the day/session key. */
  sessionCreatedAt: string;
  /** The owning session's original filename — the group header label. */
  sessionFilename: string;
  /** What you said. */
  quote: string;
  /** How a native recasts it. */
  correction: string;
  explanation: string;
  category: Category;
  severity: Severity;
  /** Offset into the session where the moment starts — the jump-to-audio target. */
  startMs: number;
}

/** The minimal finding-with-session shape the builder consumes (route-agnostic). */
export interface ArchiveSource {
  id: string;
  sessionId: string;
  sessionCreatedAt: string;
  sessionFilename: string;
  quote: string;
  correction: string;
  explanation: string;
  category: Category;
  severity: Severity;
  startMs: number;
}

/** "all" means no constraint; otherwise the single value to show. */
export type CategoryFilter = Category | "all";
export type SeverityFilter = Severity | "all";

/** The archive's search state: free text intersected with category and severity. */
export interface ArchiveFilter {
  query: string;
  category: CategoryFilter;
  severity: SeverityFilter;
}

/** One session's moments under a shared header — the legible chronological group. */
export interface ArchiveGroup {
  sessionId: string;
  sessionCreatedAt: string;
  sessionFilename: string;
  entries: ArchiveEntry[];
}

function toEntry(s: ArchiveSource): ArchiveEntry {
  return {
    findingId: s.id,
    sessionId: s.sessionId,
    sessionCreatedAt: s.sessionCreatedAt,
    sessionFilename: s.sessionFilename,
    quote: s.quote,
    correction: s.correction,
    explanation: s.explanation,
    category: s.category,
    severity: s.severity,
    startMs: s.startMs,
  };
}

/**
 * Build the timeline: every moment ordered by session date **newest first**, and
 * within a session by `startMs` ascending (the moments in the order you spoke
 * them — consistent with the analysis report). Ties break by sessionId then id so
 * the total order is deterministic and same-session entries stay contiguous
 * (so `groupBySession` can walk the result once). Pure — no DB, no model.
 */
export function buildEntries(sources: readonly ArchiveSource[]): ArchiveEntry[] {
  return sources.map(toEntry).sort((a, b) => {
    if (a.sessionCreatedAt !== b.sessionCreatedAt) {
      return a.sessionCreatedAt < b.sessionCreatedAt ? 1 : -1; // newer session first
    }
    if (a.sessionId !== b.sessionId) return a.sessionId < b.sessionId ? 1 : -1;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs; // earlier moment first
    return a.findingId < b.findingId ? -1 : a.findingId > b.findingId ? 1 : 0;
  });
}

/**
 * Narrow the timeline by a free-text query (matched case-insensitively against
 * the quote, the correction, and the explanation) AND a category AND a severity —
 * the three are an intersection. A blank/whitespace-only query matches everything;
 * "all" imposes no constraint on that axis. Pure — no DB, no model.
 */
export function filterEntries(
  entries: readonly ArchiveEntry[],
  filter: ArchiveFilter,
): ArchiveEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.category !== "all" && e.category !== filter.category) return false;
    if (filter.severity !== "all" && e.severity !== filter.severity) return false;
    if (q === "") return true;
    return (
      e.quote.toLowerCase().includes(q) ||
      e.correction.toLowerCase().includes(q) ||
      e.explanation.toLowerCase().includes(q)
    );
  });
}

/**
 * Group an already-ordered entry list by session, preserving order — each group
 * is one session's contiguous run of moments (see `buildEntries`). Pure.
 */
export function groupBySession(entries: readonly ArchiveEntry[]): ArchiveGroup[] {
  const groups: ArchiveGroup[] = [];
  for (const e of entries) {
    const last = groups[groups.length - 1];
    if (last && last.sessionId === e.sessionId) {
      last.entries.push(e);
    } else {
      groups.push({
        sessionId: e.sessionId,
        sessionCreatedAt: e.sessionCreatedAt,
        sessionFilename: e.sessionFilename,
        entries: [e],
      });
    }
  }
  return groups;
}
