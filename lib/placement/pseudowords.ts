// Pseudowords for the placement vocabulary check (E-35). These are ORIGINAL,
// license-clean Italian NON-WORDS — invented, phonotactically-plausible strings
// that obey Italian syllable structure (simple onsets, vowel-final, no foreign
// clusters) yet are attested by nothing: every entry was filtered against the
// committed morph-it lemma set AND the frequency lexicon, so none is a real lemma
// in any part of speech. A test (`tests/placement-scoring.test.ts`) re-checks this
// against `attestsLemma` so the guarantee cannot silently rot.
//
// WHY pseudowords at all: a yes/no vocabulary test is confounded by response style
// — an eager "yes-sayer" looks advanced. Interleaving non-words measures that bias
// directly: the rate at which a learner claims to "know" a word that cannot exist
// is their false-alarm rate, and the scorer subtracts it (see `scoring.ts`). They
// are the instrument's control, never shown as vocabulary to learn and never seeded
// as evidence.
//
// The list is deliberately MODEST (~50): enough to estimate a false-alarm rate
// stably without padding the repo. Pure data, client-safe (no I/O).

export const PSEUDOWORDS: readonly string[] = [
  "brellare",
  "cantrofo",
  "dilomare",
  "fistonare",
  "gramuto",
  "lentuvo",
  "micaldo",
  "nolestra",
  "palodire",
  "ravuto",
  "sconfaro",
  "tregliato",
  "ubrello",
  "vernuto",
  "zamprido",
  "frebusto",
  "falneto",
  "gestuvo",
  "mentraldo",
  "gliandeco",
  "rendofo",
  "saltrino",
  "tormeco",
  "vindolare",
  "arpesto",
  "brumaldo",
  "colteva",
  "drimonte",
  "faseglio",
  "ghirlato",
  "lumeaco",
  "nesprato",
  "pertuglio",
  "rembalo",
  "siproto",
  "tavendo",
  "valduno",
  "zeltrano",
  "ambroto",
  "bicaldo",
  "crenova",
  "dolmeto",
  "fienzato",
  "marsuto",
  "pontrego",
  "sarleco",
  "ticubro",
  "venolato",
  "grispone",
  "meldureo",
];
