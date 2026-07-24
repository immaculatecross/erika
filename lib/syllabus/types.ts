// The grammar syllabus (E-26b, D-19): Italian's grammar as a prerequisite-ordered
// curriculum, so the future daily composer (v0.5/E-31) can introduce a rule only
// once the rules it depends on are already being learned. Client-safe: pure data
// and types, no I/O. The loader and DAG validator live in the sibling modules; the
// content itself is the versioned JSON asset (`grammar-it.json`).

/** The CEFR level a rule belongs to — its place on the A1→C2 spine. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

export function isCefrLevel(x: unknown): x is CefrLevel {
  return typeof x === "string" && (CEFR_LEVELS as readonly string[]).includes(x);
}

/** The learning rank of a level (A1 = 0 … C2 = 5) — used to check a rule never
 *  depends on a rule that sits at a strictly higher CEFR level (a curriculum must
 *  not require the harder thing first). */
export function cefrRank(level: CefrLevel): number {
  return CEFR_LEVELS.indexOf(level);
}

/**
 * One grammar rule. `key` is the stable identity (→ knowledge item id `rule:<key>`);
 * `prereqs` names OTHER rules by their `key` that must precede this one in the
 * learning order (the DAG edges). Every rule carries at least one correct Italian
 * `example`. `area` is a coarse thematic grouping for authoring/inspection only —
 * it carries no scheduling meaning.
 */
export interface SyllabusRule {
  key: string;
  cefr: CefrLevel;
  area: string;
  title: string;
  description: string;
  prereqs: string[];
  examples: string[];
}

/** The versioned syllabus asset: a `version` string and the flat rule set. */
export interface Syllabus {
  version: string;
  language: string;
  source: string;
  rules: SyllabusRule[];
}

/** The knowledge item id a rule seeds as (`rule:<key>`). Mirrors `ruleItemId`
 *  in `lib/knowledge/items.ts` — kept here so the syllabus layer needs no DB import. */
export function ruleKeyToItemId(key: string): string {
  return `rule:${key}`;
}
