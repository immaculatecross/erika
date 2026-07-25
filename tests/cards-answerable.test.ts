import { describe, expect, it } from "vitest";
import {
  CLOZE_BLANK,
  MAX_TARGET_WORDS,
  MIN_CONTEXT_WORDS,
  MIN_SOLO_CONTEXT_CHARS,
  deriveFaces,
  deriveFront,
  frontIsAnswerable,
  isPronunciationArtifact,
} from "@/lib/cards-view";
import { CATEGORIES } from "@/lib/analysis/categories";
import { findingIsCardable, isCardable } from "@/lib/cards";

// ─────────────────────────────────────────────────────────────────────────────
// E-45 criterion 3 — THE TOTALITY PROOF.
//
//   INVARIANT: every card front is answerable by a learner who has never seen the
//   finding it came from — because that is every learner.
//
// The proof is in three parts, and the third is what makes it a proof rather than
// a collection of examples:
//
//   1. STRUCTURAL. `deriveFront` no longer takes a `category`, so the string
//      "grammar" cannot appear in its output — there is no path by which it enters
//      the function. This is enforced by the compiler, and asserted below only as a
//      belt-and-braces sweep over the closed CATEGORIES vocabulary.
//   2. ENUMERATION. `deriveFront` has exactly five exits (a-d refusals + the gap).
//      Each is named and driven by a fixture whose expectation comes from the
//      FIXTURE, never from the function under test.
//   3. TOTALITY. Over a generated cross-product of finding shapes covering all five
//      categories and every degenerate shape we know how to construct, the output is
//      either `null` or a front that satisfies `frontIsAnswerable`. There is no third
//      possibility, and no input in the space produces one.
//
// Expectations are derived from the fixture (the quote/correction pair we wrote),
// never from `deriveFront`'s own answer.
// ─────────────────────────────────────────────────────────────────────────────

/** The five exits of `deriveFront`, named. Each row is (name, quote, correction). */
const EXITS: { exit: string; quote: string; correction: string; answerable: boolean }[] = [
  // (a) Nothing textual was corrected — a pronunciation artifact whatever the label.
  { exit: "a: no text changed", quote: "il gatto", correction: "il gatto", answerable: false },
  { exit: "a: punctuation/case only", quote: "Il gatto.", correction: "il gatto", answerable: false },
  // (b) Pure deletion — no retrieval target.
  { exit: "b: pure deletion", quote: "non ho visto niente mai", correction: "non ho visto niente", answerable: false },
  // (c) Whole-sentence rewrite — the gap would be a sentence.
  {
    exit: "c: whole rewrite",
    quote: "boh",
    correction: "non saprei proprio come risponderti adesso",
    answerable: false,
  },
  {
    exit: "c: idiom rewrite sharing nothing",
    quote: "fare una decisione importante",
    correction: "prendere finalmente una risoluzione ponderata",
    answerable: false,
  },
  // (d) Not enough correct context to constrain the answer.
  { exit: "d: single-word fix", quote: "gatto", correction: "gatta", answerable: false },
  { exit: "d: register slip leaves one word", quote: "Non voglio", correction: "Non desidero", answerable: false },
  // The gap — the only exit that yields a front.
  {
    exit: "gap: auxiliary at the head",
    quote: "ho andato al cinema",
    correction: "sono andato al cinema",
    answerable: true,
  },
  {
    exit: "gap: articulated preposition in the middle",
    quote: "vado a il centro",
    correction: "vado al centro",
    answerable: true,
  },
  {
    exit: "gap: agreement at the tail",
    quote: "le case sono belli davvero",
    correction: "le case sono belle davvero",
    answerable: true,
  },
];

describe("deriveFront — every exit, enumerated (E-45 criterion 3)", () => {
  for (const row of EXITS) {
    it(`${row.exit} → ${row.answerable ? "an answerable gap" : "no card"}`, () => {
      const front = deriveFront(row.quote, row.correction);
      if (!row.answerable) {
        expect(front).toBeNull();
        return;
      }
      expect(front).not.toBeNull();
      // The expectation is the FIXTURE's own contract, not deriveFront's answer.
      expect(frontIsAnswerable(front!, row.correction)).toBe(true);
    });
  }
});

describe("the front never carries the learner's error or a category word", () => {
  it("no front produced from any category-shaped input contains a category name", () => {
    // Structural sweep: even when the quote and correction are literally the
    // category words, the category cannot leak in — the function is never given one.
    for (const category of CATEGORIES) {
      const front = deriveFront(`io ${category} molto`, `io parlo molto`);
      expect(front).not.toBeNull();
      expect(front!.toLowerCase()).not.toContain(category);
    }
  });

  it("every context token of a front is a token of the CORRECTION, so the error cannot appear", () => {
    const quote = "ieri ho andato al mare";
    const correction = "ieri sono andato al mare";
    const front = deriveFront(quote, correction)!;
    expect(front).toBe(`ieri ${CLOZE_BLANK} andato al mare`);
    // "ho" is the error token and is absent; every other token is in the correction.
    expect(front.split(/\s+/)).not.toContain("ho");
  });
});

describe("the Amendment 1 collision — one class, deterministically", () => {
  // lib/mistakes.ts places a blurred final vowel in BOTH class A (grammar,
  // cardable) and class C (pronunciation, uncardable). The reviewer of PR #66
  // drove a real cascade and got a card fronted "____ · grammar" whose ANSWER was
  // the word the learner already said. The tie-break must not depend on which
  // label the model happened to emit.
  const BLURRED_VOWEL = { quote: "la ragazza è stanca", correction: "la ragazza è stanca" };

  it("is recognised as a pronunciation artifact from the fields alone", () => {
    expect(isPronunciationArtifact(BLURRED_VOWEL.quote, BLURRED_VOWEL.correction)).toBe(true);
  });

  it("resolves to ONE class whichever category the model wrote", () => {
    // Same finding, both labels the model can plausibly produce. Both must land in
    // the same place: not a card. Previously "grammar" minted the broken card and
    // "pronunciation" did not — one finding, two answers.
    for (const category of ["grammar", "pronunciation"] as const) {
      expect(findingIsCardable({ category, ...BLURRED_VOWEL })).toBe(false);
    }
  });

  it("never mints a card whose answer is the word the learner already said", () => {
    expect(deriveFront(BLURRED_VOWEL.quote, BLURRED_VOWEL.correction)).toBeNull();
    expect(deriveFaces(BLURRED_VOWEL.quote, BLURRED_VOWEL.correction, "The ending was swallowed.")).toBeNull();
  });
});

// ── the property test: totality over generated shapes ────────────────────────

const CONTEXTS: { before: string[]; after: string[] }[] = [
  { before: [], after: [] },
  { before: ["Non"], after: [] },
  { before: [], after: ["davvero"] },
  { before: ["ieri"], after: ["al", "mare"] },
  { before: ["la", "settimana", "scorsa"], after: ["con", "loro"] },
];

const TARGETS: { wrong: string[]; right: string[] }[] = [
  { wrong: ["ho"], right: ["sono"] },                                // one word ↔ one word
  { wrong: ["gatto"], right: ["gatta"] },                            // minimal pair
  { wrong: ["a", "il"], right: ["al"] },                             // two ↔ one
  { wrong: ["fare"], right: ["prendere", "una", "decisione"] },      // one ↔ three
  { wrong: ["x"], right: ["a", "b", "c", "d", "e", "f"] },           // one ↔ six (over MAX)
  { wrong: ["di", "più"], right: [] },                               // pure deletion
  { wrong: ["uguale"], right: ["uguale"] },                          // identical (artifact)
];

describe("TOTALITY — over every generated finding shape, the output is null or answerable", () => {
  it("has no third possibility across all categories × contexts × target shapes", () => {
    let answerableCount = 0;
    let refusedCount = 0;

    for (const category of CATEGORIES) {
      for (const ctx of CONTEXTS) {
        for (const t of TARGETS) {
          const quote = [...ctx.before, ...t.wrong, ...ctx.after].join(" ");
          const correction = [...ctx.before, ...t.right, ...ctx.after].join(" ");
          const front = deriveFront(quote, correction);

          if (front === null) {
            refusedCount++;
            // A refusal must also make the finding non-cardable on BOTH card paths.
            expect(findingIsCardable({ category, quote, correction })).toBe(false);
            continue;
          }

          answerableCount++;
          // 1. Answerable by the stated predicate.
          expect(frontIsAnswerable(front, correction)).toBe(true);
          // 2. Exactly one blank, and it is the blank constant.
          expect(front.split(/\s+/).filter((w) => w === CLOZE_BLANK)).toHaveLength(1);
          // 3. Never a bare category word — asserted against the whole vocabulary.
          for (const c of CATEGORIES) expect(front.toLowerCase()).not.toContain(c);
          // 4. Enough correct context — computed from the FIXTURE's own words, not
          //    from anything deriveFront returned, so this is a specification and
          //    not a restatement of the implementation's answer.
          const ctxWords = [...ctx.before, ...ctx.after];
          const solo =
            ctxWords.length === 1 && t.right.length === 1 && ctxWords[0].length >= MIN_SOLO_CONTEXT_CHARS;
          expect(ctxWords.length >= MIN_CONTEXT_WORDS || solo).toBe(true);
          // 5. The hidden span is bounded, from the fixture's own count.
          expect(t.right.length).toBeGreaterThanOrEqual(1);
          expect(t.right.length).toBeLessThanOrEqual(MAX_TARGET_WORDS);
          // 6. A cardable-category finding of this shape IS cardable.
          expect(findingIsCardable({ category, quote, correction })).toBe(isCardable(category));
        }
      }
    }

    // Assert the POSITIVE: the sweep really did produce answerable fronts, so
    // "no unanswerable front" is not satisfied by producing no fronts at all.
    expect(answerableCount).toBeGreaterThan(0);
    expect(refusedCount).toBeGreaterThan(0);
    expect(answerableCount + refusedCount).toBe(CATEGORIES.length * CONTEXTS.length * TARGETS.length);
  });
});
