// THE CLOSED CATEGORY VOCABULARY, and how a model's answer is coerced into it.
//
// Extracted from lib/analysis/findings.ts (E-42) when the marker table pushed that
// file past the 500-line hook. It is a cohesive unit in its own right — the five
// words the schema stores, plus the whole of the "what did the model actually mean"
// problem — and nothing here touches the database. `lib/analysis/findings.ts`
// re-exports all of it, so every existing importer is unchanged.
//
// Why the coercion is three steps and not a lookup: see `normalizeCategory`.

export const CATEGORIES = ["grammar", "vocabulary", "phrasing", "idiom", "pronunciation"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(v: unknown): v is Category {
  return typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);
}

/**
 * Near-misses for the closed category vocabulary, mapped to the value the schema
 * stores (E-39 workstream A).
 *
 * The gap this closes. `parseDeepResponse` rejects the WHOLE deep reply when any one
 * finding's `category` is off-vocabulary, and that is deliberate — half a segment's
 * garbage must never persist (E-16 criterion 2). But the punishment landed on the
 * wrong offender: a model that had correctly HEARD five mistakes and labelled one of
 * them "word choice" instead of "vocabulary" lost all five, and the segment was
 * recorded as unreadable. The class of mistake most exposed to it was precisely the
 * one the operator says is missing — vocabulary, whose natural English name is "word
 * choice". So this is a coverage fix, not a leniency: the findings were there and the
 * pipeline threw them away over a synonym.
 *
 * Every alias is an UNAMBIGUOUS synonym of exactly one category — a term that could
 * plausibly belong to two (e.g. "usage") is deliberately absent, because guessing
 * would mislabel a finding and mislabelling is worse than rejecting. An unrecognised
 * value still fails the whole reply exactly as before.
 *
 * [E-42 criterion 14] `register` IS NOW ACCEPTED, and it was the one label the prompt
 * actively invited while the parser refused it. `lib/mistakes.ts` class B names a
 * register slip as a mistake, `ENRICHED_NOTES_INSTRUCTION` puts "register" in front of
 * the model as a field name, and D-23 makes the register dial a first-class idea — so
 * a reply labelling a finding "register" was always likely, and the cost of refusing
 * it was not one lost finding but the WHOLE SEGMENT (`parseDeepResponse` rejects the
 * entire reply on an off-vocabulary category). This entry used to be excluded as
 * "ambiguous", but the ambiguity was ours and it is now settled in one place: a
 * register slip is a WORD-CHOICE mistake (lib/register.ts, criterion 12), the prompt
 * says so explicitly, and the schema stores it as `vocabulary`. A class the model is
 * asked to produce and the schema silently discards is the exact defect PR #66 existed
 * to remove.
 */
const CATEGORY_ALIASES: Readonly<Record<string, Category>> = {
  // vocabulary — the wrong-word class, and the aliases a model actually reaches for.
  "word choice": "vocabulary",
  wordchoice: "vocabulary",
  word: "vocabulary",
  vocab: "vocabulary",
  lexis: "vocabulary",
  lexical: "vocabulary",
  lexicon: "vocabulary",
  "false friend": "vocabulary",
  collocation: "vocabulary",
  register: "vocabulary",
  // grammar — a wrong form, under any of its technical names.
  grammatical: "grammar",
  syntax: "grammar",
  syntactic: "grammar",
  morphology: "grammar",
  morphological: "grammar",
  agreement: "grammar",
  conjugation: "grammar",
  tense: "grammar",
  // pronunciation — including the misspelling models produce most often.
  pronounciation: "pronunciation",
  phonetic: "pronunciation",
  phonetics: "pronunciation",
  phonology: "pronunciation",
  phonological: "pronunciation",
  accent: "pronunciation",
  // idiom / phrasing.
  idiomatic: "idiom",
  idioms: "idiom",
  expression: "idiom",
  phrase: "phrasing",
  wording: "phrasing",
};

/**
 * Marker phrases that identify a category inside a longer label — the third and
 * last resort, after the exact vocabulary and the curated alias table.
 *
 * [E-42 · spike-6] Why an exact list of aliases was never going to be enough. A live
 * run of ~130 real calls found `gpt-audio-1.5` answering `"vocabulary and word
 * choice"` on 3 of 27 findings — which is the *heading* of class B in
 * `lib/mistakes.ts` (`VOCABULARY AND WORD CHOICE`), composed into the very prompt
 * that asks the question. The model was echoing our own words back and the parser
 * refused them. Enumerating that one string would fix that one string; the next
 * heading, join word or plural would fail exactly the same way.
 *
 * So the last resort is containment, with an ambiguity rule that is the whole point:
 * a label is resolved only when it points at EXACTLY ONE category. "vocabulary and
 * word choice" hits two markers in the same set, which is one category — resolved.
 * "grammar and vocabulary" hits two different sets — refused, because guessing
 * between them would mislabel a finding, and mislabelling is worse than dropping.
 */
const CATEGORY_MARKERS: ReadonlyArray<readonly [Category, readonly string[]]> = [
  ["grammar", ["grammar", "grammatical", "syntax", "syntactic", "morpholog", "agreement", "conjugation", "tense", "inflection", "word order"]],
  ["vocabulary", ["vocabulary", "vocab", "word choice", "wordchoice", "lexis", "lexical", "lexicon", "false friend", "calque", "collocation", "register"]],
  ["pronunciation", ["pronunciation", "pronounciation", "phonetic", "phonolog", "gemination", "mispronounc"]],
  ["idiom", ["idiom"]],
  ["phrasing", ["phrasing", "wording", "naturalness"]],
];

/**
 * Coerce a model's `category` to the stored vocabulary, or null if unrecognisable.
 *
 * Three steps, narrowest first: the exact vocabulary; then the curated alias table
 * of unambiguous synonyms; then containment over `CATEGORY_MARKERS`, which resolves
 * a longer label only when it points at exactly one category. Case, surrounding
 * space, and `_`/`-` separators are normalised before any of them, so "Grammar",
 * "word_choice" and "  grammar  " are all the same claim.
 *
 * Null — never a guess and never a default — is still the answer for a genuinely
 * unreadable label. What changed in E-42 is what null COSTS: it now drops that one
 * finding instead of the whole segment (see `parseDeepResponse`).
 */
export function normalizeCategory(v: unknown): Category | null {
  if (typeof v !== "string") return null;
  const key = v.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (key === "") return null;
  if (isCategory(key)) return key;
  const alias = CATEGORY_ALIASES[key];
  if (alias) return alias;
  const hits = CATEGORY_MARKERS.filter(([, markers]) => markers.some((m) => key.includes(m)));
  return hits.length === 1 ? hits[0][0] : null;
}

/**
 * How the three shared mistake classes map onto the CLOSED five-word `category`
 * vocabulary the schema stores (E-39). Without this the model was left to guess which
 * label a false friend or a wrong preposition wears — and an off-vocabulary guess is
 * not a mild loss: `parseDeepResponse` rejects the WHOLE reply, so one stray word
 * ("word choice") discarded every finding for that segment. `normalizeCategory`
 * recovers the recognisable near-misses; this line is the front half of the same fix.
 * Lives here (not in prompts.ts) so client-safe tutor prompt builders can compose it
 * without pulling the analysis profile/findings graph (and node:crypto) into the
 * browser bundle.
 */
export const CATEGORY_MAPPING_INSTRUCTION =
  'Map each finding onto exactly one of the five category words: "grammar" for a wrong form;' +
  ' "vocabulary" for a wrong word — a false friend, a calqued word, a wrong collocation, a noun\'s' +
  " own gender, or a register slip (a register slip is a word-choice mistake: label it" +
  ' "vocabulary", not "register"); "pronunciation" for a wrong sound; "idiom" for a fixed' +
  ' expression misused or translated literally; "phrasing" for wording that is grammatical and' +
  " understood but not how an Italian would put it. Use one of those five words exactly and" +
  " lower-case — NOT the heading of the class it came from: a finding from the class headed" +
  ' "VOCABULARY AND WORD CHOICE" has the category "vocabulary". Any other value is unreadable' +
  " to us and that finding is lost.";

