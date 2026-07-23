// The knowledge model's part-of-speech scheme and the morph-it → scheme mapping
// (E-25). A knowledge lemma item is keyed by (lemma, POS); this file defines the
// small, closed POS vocabulary those ids use and how morph-it's fine-grained
// morphological tags collapse onto it. Client-safe: pure data, no I/O.
//
// The scheme is a coarse Universal-POS-style set — enough to disambiguate the
// homographs the knowledge model cares about (a NOUN vs. a VERB reading of one
// form) without carrying morph-it's inflectional detail, which the derived state
// never needs. The mapping is deterministic over the real file (D-13: the file is
// its own oracle), and coarsening is deliberate: morph-it's numeral and clitic
// sub-tags fold into DET/PRON, its auxiliary/modal/causative/aspectual verbs into
// VERB (AUX kept apart because essere/avere behave differently), and punctuation /
// sentence / symbol tags are dropped as non-words.

export const POS_TAGS = [
  "NOUN",
  "PROPN",
  "VERB",
  "AUX",
  "ADJ",
  "ADV",
  "PRON",
  "DET",
  "ADP",
  "CCONJ",
  "INTJ",
] as const;

export type Pos = (typeof POS_TAGS)[number];

export function isPos(v: unknown): v is Pos {
  return typeof v === "string" && (POS_TAGS as readonly string[]).includes(v);
}

/**
 * Map a morph-it feature tag (the third TSV column, e.g. `NOUN-M:p`, `VER:ind…`,
 * `ADJ:pos+m+s`) onto this scheme, or null if it is a non-word to drop
 * (punctuation `PON`, sentence `SENT`, symbols `SYM`, and the rare tags with no
 * lexical reading). Keyed on the tag's base — the part before the first `:` or
 * `-` — so every inflection of a category maps the same way.
 */
export function morphitTagToPos(tag: string): Pos | null {
  const base = tag.split(/[:-]/, 1)[0];
  return MORPHIT_BASE_TO_POS[base] ?? null;
}

const MORPHIT_BASE_TO_POS: Record<string, Pos> = {
  // Nouns and proper nouns.
  NOUN: "NOUN",
  NPR: "PROPN",
  NE: "PROPN",
  // Verbs: lexical, plus modal/causative/aspectual which are still verbs;
  // auxiliaries kept apart (essere/avere).
  VER: "VERB",
  MOD: "VERB",
  CAU: "VERB",
  ASP: "VERB",
  AUX: "AUX",
  // Modifiers.
  ADJ: "ADJ",
  ADV: "ADV",
  // Pronouns, including clitics and interrogatives.
  PRO: "PRON",
  SMI: "PRON",
  SI: "PRON",
  CI: "PRON",
  CE: "PRON",
  WH: "PRON",
  // Determiners and articles (numeral determiners fold in via their DET base).
  DET: "DET",
  ART: "DET",
  // Adpositions: simple and articulated prepositions.
  PRE: "ADP",
  ARTPRE: "ADP",
  // Conjunctions and interjections.
  CON: "CCONJ",
  INT: "INTJ",
};
