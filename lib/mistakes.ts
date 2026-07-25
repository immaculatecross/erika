// ─────────────────────────────────────────────────────────────────────────────
// What counts as a mistake (E-39 workstream A). ONE definition, shared by the two
// paths that hunt for the learner's errors: the Realtime tutor's persona
// (lib/tutor/persona.ts) and the Record deep-listen prompt (lib/analysis/prompts.ts).
// Pure strings — no I/O, no model call, client-safe — in the style of lib/register.ts.
//
// Why it is shared. Before E-39 each path carried its own idea of an error and they
// disagreed. The tutor ranked final-vowel / -o/-a agreement as its single highest
// priority, put "grammar and word choice" third, and never named vocabulary at all —
// an operator EXAMPLE encoded as the spec. The deep prompt asked only for "each
// genuine error" and listed its five category names with no statement of what any of
// them covers, so which classes it actually caught was left to the model's mood.
// Whether a wrong word or a wrong preposition is a mistake must not depend on which
// surface heard it, so the definition lives here and both paths compose it.
//
// The three classes are PEERS: grammar, vocabulary/word choice, pronunciation. No
// class outranks another, and -o/-a agreement is one worked example inside the
// agreement bullet — which is where an example belongs.
//
// Comprehensiveness here is coverage of WHAT COUNTS as a mistake, never a licence to
// interrupt more. `PRECISION_CORE_LINES` below (never invent, never infer, degree
// yields) and the per-turn cap in the persona (`IN_THE_FLOW`) are what keep a wider
// net from becoming a flood of false corrections; widening this list without them is
// the opposite failure, and just as bad as the narrowness it replaces.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three classes of mistake, with worked Italian examples. Presented as peers:
 * the header says so explicitly, because a numbered "priority order" is exactly how
 * one example came to outrank two whole categories.
 *
 * Each bullet names a class of error and shows it: an error class stated abstractly
 * ("agreement", "collocation") is one a model can nod along to and never apply,
 * whereas "penso che è vero — penso che sia vero" is unmistakable. The examples are
 * the specification.
 */
export const MISTAKE_CLASS_LINES: readonly string[] = [
  "Mistakes come in three classes and all three matter equally — GRAMMAR, VOCABULARY AND WORD CHOICE, and PRONUNCIATION. No class outranks another. All of the following count as real errors, not slips to overlook:",
  "A. GRAMMAR — the words are right but a form is wrong.",
  "- Agreement of gender and number, across article, noun, adjective, and past participle. The final vowel is where this usually shows, because in Italian the ending IS the gender and number marker: \"la ragazzo\" (it's \"il ragazzo\"), \"le case sono belli\" (it's \"le case sono belle\"), \"signora, è stanco\" (it's \"è stanca\"). An ending swallowed, cut short, or centralised until -o and -a cannot be told apart is this same error, heard rather than spelled — but an ending that disagrees with the SPEAKER themselves counts only when they have told you which form applies to them (see the rule on gender below).",
  "- Tense, mood, and aspect: passato prossimo against imperfetto (\"ieri andavo al cinema\" for one completed outing — \"ieri sono andato al cinema\"), the congiuntivo after penso che / credo che / benché (\"penso che è vero\" — \"penso che sia vero\"), the condizionale in a hypothetical (\"se avevo tempo, venivo\" — \"se avessi tempo, verrei\"), and an infinitive or gerund where a conjugated verb belongs.",
  "- Auxiliary choice, essere against avere, and the participle agreement that follows from it (\"ho andato\" — \"sono andato\").",
  "- Articles and prepositions: il / lo / l' (\"il studente\" — \"lo studente\"), a definite article missing or added where Italian does the opposite, articulated prepositions (\"a il centro\" — \"al centro\"), and the choice of preposition itself (\"vado in Italia\" but \"vado a Roma\"; \"riesco a\", \"dipende da\", \"penso di\" against \"penso a\").",
  "- Clitics and pronouns: ne and ci, direct against indirect (\"lo telefono\" — \"gli telefono\"), placement with infinitives and imperatives, the combined forms (\"me lo\", \"glielo\"), and a reflexive si missing or spurious.",
  "- Word order and sentence structure, including negation (\"non ho visto niente\") and how a question is built.",
  "B. VOCABULARY AND WORD CHOICE — the grammar is intact but the word is wrong. This is a real mistake, not a matter of taste, and a sentence can be flawless grammar and still say the wrong thing.",
  "- The wrong word for the meaning: a well-formed sentence that says something the learner did not mean.",
  "- False friends: \"attualmente\" for \"actually\" (it means currently — \"in realtà\"), \"eventualmente\" for \"eventually\" (it means possibly — \"alla fine\"), \"libreria\" for a lending library (\"biblioteca\"), \"parenti\" for parents (\"genitori\"), \"fabbrica\" for fabric (\"tessuto\").",
  "- Calques — an expression carried over word for word from another language that no Italian would say (\"fare una decisione\" — \"prendere una decisione\").",
  "- Collocation: the right noun with the wrong verb (\"fare una domanda\", \"prendere una decisione\", \"sostenere un esame\").",
  "- A noun whose own gender they have simply learned wrong — a fact about the word, not about the ending (\"la problema\" — \"il problema\"; \"il mano\" — \"la mano\").",
  "- Register: a word or turn of phrase plainly outside the register named above, in either direction — slang where the register is elevated, or something stiff and bookish where it is colloquial. Judge it against THAT register, never against your own preference, and only when the mismatch is plain.",
  "C. PRONUNCIATION — the word is right but the sound is wrong, when you actually hear one go wrong: double consonants and geminates (fato against fatto, casa against cassa, note against notte), gli /ʎ/, gn /ɲ/, the Italian r, c and g before front against back vowels (ci/ce against ca/co/cu, gi/ge against ga/go/gu), voiced against voiceless s and z (rosa, zio), an intruding consonant or extra schwa at the end of a word, misplaced stress (ancora against àncora, parlo against parlò), and a final vowel blurred until the ending is lost.",
];

/**
 * The three classes as one prompt block. Both consumers compose this — neither
 * restates it — so the two paths cannot drift apart on what a mistake is.
 */
export function mistakeClasses(): string {
  return MISTAKE_CLASS_LINES.join("\n");
}

/**
 * The precision core (D-19 honesty, D-21). Shared verbatim with the class list,
 * because a wider net without it is how an error hunter starts manufacturing errors.
 * Three distinct uncertainty holes, not one:
 *  - AUDIBILITY — did you actually hear it, and is it actually wrong (the base rule);
 *  - THE SPEAKER — we never know the learner's gender, and `renderProfileLines`
 *    (E-19) never emits it, so a self-agreement judgment could only come from a
 *    voice-based inference: it would "correct" correct speech, and it sits badly
 *    beside D-2's privacy stance;
 *  - DEGREE — D-21: audio LLMs diagnose phones from L1 stereotypes rather than
 *    acoustics, which is why the deep pass flags pronunciation as a suspect only.
 *    Word- and grammar-level calls stay confident; sub-phonemic calls of degree
 *    yield, and an assumed L1 is never itself evidence of an error.
 */
export const PRECISION_CORE_LINES: readonly string[] = [
  "Never invent an error. Being thorough means catching the mistakes that are really there — not manufacturing mistakes to seem useful. If you did not clearly hear it, do not flag it. Do not guess at something you half-heard, do not flag a regional or otherwise acceptable variant as wrong, and never produce a correction just to fill a silence or to seem attentive. A false correction is worse than a missed one: the learner trusts you and will learn the wrong thing from it.",
  "You are not told the learner's gender and must never infer it from their voice: only treat an ending that disagrees with the speaker themselves as an error if they have told you which form applies to them.",
  "Your judgment of fine phonetic detail — a slightly centralised vowel, a borderline double consonant, a stress you are unsure of — is far less reliable than your judgment of words and grammar: when it is only a matter of degree, let it go, and never infer an error from what speakers of the learner's native language are expected to get wrong. Flag what you actually heard, never what their L1 predicts.",
];

/** The precision core as one prompt paragraph. */
export function precisionCore(): string {
  return PRECISION_CORE_LINES.join(" ");
}
