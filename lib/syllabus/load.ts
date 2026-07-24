import { isCefrLevel, type Syllabus, type SyllabusRule } from "./types";
import raw from "./grammar-it.json";

// Loader for the committed grammar syllabus asset (E-26b). Parses and shape-checks
// `grammar-it.json`, the single source of the rule inventory. The JSON is imported
// directly (Next/TS resolves it, and it bundles into any build output — no cwd- or
// filesystem-relative read, unlike the gzipped lexicon asset), then validated into
// a typed `Syllabus`. Client-safe: pure data, no I/O. The DAG validation (acyclic,
// resolvable prereqs, topologically sortable) is the sibling `validate.ts`.

/** Thrown when the syllabus JSON is structurally malformed (before DAG checks). */
export class SyllabusShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyllabusShapeError";
  }
}

function isStringArray(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((s) => typeof s === "string");
}

function checkRule(r: unknown, i: number): SyllabusRule {
  if (typeof r !== "object" || r === null) throw new SyllabusShapeError(`rule[${i}] is not an object`);
  const o = r as Record<string, unknown>;
  const where = typeof o.key === "string" ? `rule "${o.key}"` : `rule[${i}]`;
  if (typeof o.key !== "string" || o.key.length === 0) throw new SyllabusShapeError(`${where} has no key`);
  if (!/^[a-z0-9-]+$/.test(o.key)) throw new SyllabusShapeError(`${where} key must be kebab-case [a-z0-9-]`);
  if (!isCefrLevel(o.cefr)) throw new SyllabusShapeError(`${where} has an invalid cefr level`);
  if (typeof o.area !== "string" || o.area.length === 0) throw new SyllabusShapeError(`${where} has no area`);
  if (typeof o.title !== "string" || o.title.length === 0) throw new SyllabusShapeError(`${where} has no title`);
  if (typeof o.description !== "string" || o.description.length === 0)
    throw new SyllabusShapeError(`${where} has no description`);
  if (!isStringArray(o.prereqs)) throw new SyllabusShapeError(`${where} prereqs must be a string array`);
  if (!isStringArray(o.examples) || o.examples.length === 0)
    throw new SyllabusShapeError(`${where} needs at least one example`);
  return {
    key: o.key,
    cefr: o.cefr,
    area: o.area,
    title: o.title,
    description: o.description,
    prereqs: o.prereqs,
    examples: o.examples,
  };
}

let cache: Syllabus | null = null;

/** Load, shape-check and memoise the syllabus asset. Throws `SyllabusShapeError`
 *  on a malformed asset (a committed asset should never trip this — the test does). */
export function loadSyllabus(): Syllabus {
  if (cache) return cache;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "string" || o.version.length === 0)
    throw new SyllabusShapeError("syllabus has no version");
  if (typeof o.language !== "string") throw new SyllabusShapeError("syllabus has no language");
  if (typeof o.source !== "string") throw new SyllabusShapeError("syllabus has no source");
  if (!Array.isArray(o.rules)) throw new SyllabusShapeError("syllabus has no rules array");
  const rules = o.rules.map((r, i) => checkRule(r, i));
  const seen = new Set<string>();
  for (const r of rules) {
    if (seen.has(r.key)) throw new SyllabusShapeError(`duplicate rule key "${r.key}"`);
    seen.add(r.key);
  }
  cache = { version: o.version, language: o.language, source: o.source, rules };
  return cache;
}

/** Reset the memoised syllabus (tests only). */
export function _resetSyllabusCache(): void {
  cache = null;
}
