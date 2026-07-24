import type { Db } from "./db";
import type { Category } from "./analysis/findings";
import { CATEGORY_ORDER } from "./analysis-view";
import { computeSlipStandings } from "./slips";

// The Learn map strip (E-38, D-24 / DESIGN.md:47). One compact cell per category,
// tinting toward green ONLY through resolved-slip semantics.
//
// GREEN MEANS MASTERY, NEVER ACTIVITY. This is the whole point of the surface and
// the one way it can be got wrong. A cell's tint is the share of that category's
// recurring mistakes that are RESOLVED — the exact standing `lib/slip-standing.ts`
// computes, which since RETRO-003 already requires a positive production/drill event
// AFTER the last recurrence. There is deliberately no second notion of mastery here:
// this module reduces `computeSlipStandings`, the same read-only standing Focus's
// green count reduces, and it never looks at how much anyone practised. A learner
// who drills for hours and resolves nothing sees no green; a learner who resolves a
// slip sees green without practising anything else. Categories with no slips at all
// are neutral, not green — nothing has been shown to be mastered.
//
// Read-only (no materialization) and hand-rolled — no charting library (WO).

/** How many discrete tint steps a cell can wear (0 = neutral). Discrete so the
 *  strip reads as a map rather than a gradient, and so the classes stay static. */
export const MASTERY_BANDS = 4;

/** One category cell. */
export interface MapCell {
  category: Category;
  /** Recurring mistakes in this category (the denominator). */
  slips: number;
  /** How many of them are resolved — the ONLY thing that makes a cell green. */
  resolved: number;
  /** resolved / slips, 0 when there are no slips. */
  mastery: number;
  /** The tint step 0..MASTERY_BANDS. 0 = no green at all. */
  band: number;
}

/** The tint step for a mastery fraction. Any resolved slip earns at least band 1;
 *  0 resolved is band 0 — the neutral cell — however busy the category is. */
export function masteryBand(resolved: number, slips: number): number {
  if (slips <= 0 || resolved <= 0) return 0;
  const fraction = resolved / slips;
  return Math.max(1, Math.min(MASTERY_BANDS, Math.ceil(fraction * MASTERY_BANDS)));
}

/** Build the strip from slip standings — pure, so the "activity is not green" rule
 *  is testable without a database. */
export function buildMapCells(standings: readonly { category: Category; state: string }[]): MapCell[] {
  const slips = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  const resolved = new Map<Category, number>(CATEGORY_ORDER.map((c) => [c, 0]));
  for (const s of standings) {
    if (!slips.has(s.category)) continue;
    slips.set(s.category, (slips.get(s.category) ?? 0) + 1);
    if (s.state === "resolved") resolved.set(s.category, (resolved.get(s.category) ?? 0) + 1);
  }
  return CATEGORY_ORDER.map((category) => {
    const n = slips.get(category) ?? 0;
    const r = resolved.get(category) ?? 0;
    return { category, slips: n, resolved: r, mastery: n > 0 ? r / n : 0, band: masteryBand(r, n) };
  });
}

/** The map strip for the whole database. Read-only; no model calls. */
export function buildKnowledgeMap(db: Db): MapCell[] {
  return buildMapCells(computeSlipStandings(db));
}
