import { isCefrLevel, cefrRank, type CefrLevel } from "../syllabus/types";
import raw from "./passages.json";

// The committed public-domain Italian canon (E-33, D-19). Client-safe: pure data
// and shape validation, no I/O. The asset is `passages.json` (imported directly, the
// grammar-syllabus precedent) with its provenance/license in the sibling NOTICE.md.
// Modest by design — one leveled passage per CEFR band — this demonstrates the
// reading/listening format, it is not a library. D-19 license discipline: every
// passage is PUBLIC DOMAIN only, attributed; nothing copyrighted enters this path.

/** One canon passage: an attributed, public-domain excerpt at a CEFR reading band. */
export interface CanonPassage {
  id: string;
  author: string;
  work: string;
  year: number;
  /** The excerpt's reading band — an authoring difficulty judgment used to match a
   *  learner's edge, NOT a measured CEFR level (like the lexicon's rank-derived band). */
  cefr: CefrLevel;
  text: string;
  /** Where the public-domain transcription comes from. */
  source: string;
}

export interface Canon {
  version: string;
  language: string;
  /** Always "public-domain" — the D-19 guarantee, asserted in tests. */
  license: string;
  passages: CanonPassage[];
}

/** Thrown when the canon asset is structurally malformed or not license-clean. */
export class CanonShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonShapeError";
  }
}

function checkPassage(p: unknown, i: number): CanonPassage {
  if (typeof p !== "object" || p === null) throw new CanonShapeError(`passage[${i}] is not an object`);
  const o = p as Record<string, unknown>;
  const where = typeof o.id === "string" ? `passage "${o.id}"` : `passage[${i}]`;
  if (typeof o.id !== "string" || o.id.length === 0) throw new CanonShapeError(`${where} has no id`);
  if (typeof o.author !== "string" || o.author.length === 0) throw new CanonShapeError(`${where} has no author`);
  if (typeof o.work !== "string" || o.work.length === 0) throw new CanonShapeError(`${where} has no work`);
  if (typeof o.year !== "number") throw new CanonShapeError(`${where} has no year`);
  if (!isCefrLevel(o.cefr)) throw new CanonShapeError(`${where} has an invalid cefr band`);
  if (typeof o.text !== "string" || o.text.trim().length === 0) throw new CanonShapeError(`${where} has no text`);
  if (typeof o.source !== "string" || o.source.length === 0) throw new CanonShapeError(`${where} has no source`);
  return { id: o.id, author: o.author, work: o.work, year: o.year, cefr: o.cefr, text: o.text.trim(), source: o.source };
}

let cache: Canon | null = null;

/** Load, shape-check and memoise the canon asset. Throws `CanonShapeError` on a
 *  malformed or non-public-domain asset (the committed asset never trips this; the
 *  test does). */
export function loadCanon(): Canon {
  if (cache) return cache;
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "string" || o.version.length === 0) throw new CanonShapeError("canon has no version");
  if (typeof o.language !== "string") throw new CanonShapeError("canon has no language");
  if (o.license !== "public-domain") throw new CanonShapeError("canon must be license 'public-domain' (D-19)");
  if (!Array.isArray(o.passages) || o.passages.length === 0) throw new CanonShapeError("canon has no passages");
  const passages = o.passages.map((p, i) => checkPassage(p, i));
  const seen = new Set<string>();
  for (const p of passages) {
    if (seen.has(p.id)) throw new CanonShapeError(`duplicate passage id "${p.id}"`);
    seen.add(p.id);
  }
  cache = { version: o.version, language: o.language, license: o.license, passages };
  return cache;
}

/** One passage by id, or null. */
export function getPassage(id: string): CanonPassage | null {
  return loadCanon().passages.find((p) => p.id === id) ?? null;
}

/** Reset the memoised canon (tests only). */
export function _resetCanonCache(): void {
  cache = null;
}

export { cefrRank };
