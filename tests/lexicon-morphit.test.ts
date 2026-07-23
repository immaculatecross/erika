import { describe, expect, it } from "vitest";
import { attestsLemma, attestedCount } from "@/lib/lexicon/morphit";
import { morphitTagToPos, isPos, POS_TAGS } from "@/lib/lexicon/pos";

// The morph-it canonical-lemma validator (E-25 criterion 2). A deterministic
// lookup of real Morph-it! data: the committed reduced asset is the file's own
// distinct (lemma, POS) set, so the file is its own oracle (D-13) — a real pair
// validates, a fabricated one or a wrong POS does not. No network: the asset is in
// the repo and loaded from disk.

describe("morphitTagToPos — morph-it tags → the POS scheme", () => {
  it("maps real lexical tags and drops punctuation / non-words", () => {
    expect(morphitTagToPos("NOUN-F:p")).toBe("NOUN");
    expect(morphitTagToPos("NOUN-M:s")).toBe("NOUN");
    expect(morphitTagToPos("VER:ind+pres+3+s")).toBe("VERB");
    expect(morphitTagToPos("AUX:ind+pres+3+s")).toBe("AUX");
    expect(morphitTagToPos("ADJ:pos+m+s")).toBe("ADJ");
    expect(morphitTagToPos("ADV")).toBe("ADV");
    expect(morphitTagToPos("ARTPRE-M")).toBe("ADP"); // articulated preposition
    expect(morphitTagToPos("PRE")).toBe("ADP");
    expect(morphitTagToPos("CON")).toBe("CCONJ");
    expect(morphitTagToPos("NPR")).toBe("PROPN");
    // Dropped: punctuation, sentence and symbol rows are non-words.
    expect(morphitTagToPos("PON")).toBeNull();
    expect(morphitTagToPos("SENT")).toBeNull();
    expect(morphitTagToPos("SYM")).toBeNull();
    // Every mapped POS is in the scheme.
    for (const tag of ["NOUN-F:p", "VER:ind", "ADJ:pos", "ADV", "PRE", "CON", "NPR"]) {
      const pos = morphitTagToPos(tag);
      expect(pos !== null && isPos(pos)).toBe(true);
    }
  });
});

describe("attestsLemma — the validator gate", () => {
  it("validates real (lemma, POS) pairs morph-it attests", () => {
    expect(attestsLemma("casa", "NOUN")).toBe(true);
    expect(attestsLemma("mangiare", "VERB")).toBe(true);
    expect(attestsLemma("bello", "ADJ")).toBe(true);
    expect(attestsLemma("parlare", "VERB")).toBe(true);
  });

  it("rejects a fabricated lemma", () => {
    expect(attestsLemma("zzzfoo", "NOUN")).toBe(false);
    expect(attestsLemma("qwertyuiop", "VERB")).toBe(false);
  });

  it("rejects a real lemma under the wrong POS", () => {
    expect(attestsLemma("casa", "VERB")).toBe(false); // 'casa' is a noun, not a verb
    expect(attestsLemma("mangiare", "NOUN")).toBe(false);
  });

  it("rejects a POS outside the scheme and empty input", () => {
    expect(attestsLemma("casa", "BOGUS")).toBe(false);
    expect(attestsLemma("", "NOUN")).toBe(false);
  });

  it("loaded a substantial, real inventory", () => {
    // The reduction of ~505k rows lands tens of thousands of distinct (lemma, POS)
    // pairs — a sanity floor, not an exact count (regenerating is deterministic).
    expect(attestedCount()).toBeGreaterThan(30_000);
  });

  it("the POS scheme is the closed set the ids use", () => {
    expect(POS_TAGS).toContain("NOUN");
    expect(POS_TAGS).toContain("VERB");
    expect(new Set(POS_TAGS).size).toBe(POS_TAGS.length); // no duplicates
  });
});
