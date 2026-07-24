import { describe, expect, it } from "vitest";
import { CLOZE_BLANK, deriveFaces, deriveFront } from "@/lib/cards-view";

// Correction-forward front derivation (E-29, D-18): the drill stimulus is a
// meaning-first cue toward the CORRECT form, never the user's error. These are pure
// functions over finding fields — no DB, no model — so the invariant "the front
// never contains the raw error quote" is proven directly.

describe("deriveFront — the context gap toward the correct form", () => {
  it("blanks the changed span of the correction, keeping the correct context", () => {
    // A localized fix (essere vs avere): the surrounding correct Italian is the cue.
    const front = deriveFront("io ho andato a casa", "io sono andato a casa", "grammar");
    expect(front).toBe("io ____ andato a casa");
    expect(front).toContain(CLOZE_BLANK);
  });

  it("never contains the user's raw error — not the whole quote, not the wrong token", () => {
    const quote = "io ho andato a casa";
    const front = deriveFront(quote, "io sono andato a casa", "grammar");
    expect(front).not.toContain(quote); // the whole error utterance is absent
    expect(front.split(/\s+/)).not.toContain("ho"); // the erroneous token itself is gone
  });

  it("cues from trailing context when the change is at the start", () => {
    // make → take: no leading common word, but "a photo" is shared correct context.
    expect(deriveFront("make a photo", "take a photo", "vocabulary")).toBe("____ a photo");
  });

  it("degrades to a category-cued prompt (no error text) when there is no shared context", () => {
    // A whole rewrite has no correct context to cue from without a model.
    const front = deriveFront("boh", "una frase completamente diversa", "phrasing");
    expect(front).toBe(`${CLOZE_BLANK} · phrasing`);
    expect(front).not.toContain("boh");
  });

  it("degrades on an identical recast (e.g. a pronunciation flag), never echoing it", () => {
    // The recast spelling equals the utterance (the error was phonetic) — there is
    // no textual span to blank, so it degrades rather than show the word as answer.
    expect(deriveFront("gatto", "gatto", "pronunciation")).toBe(`${CLOZE_BLANK} · pronunciation`);
  });
});

describe("deriveFaces — the four display faces", () => {
  it("resolves front/correction/why/error, error carrying the raw quote for the marked back", () => {
    const faces = deriveFaces("io ho andato", "io sono andato", "passato prossimo con essere", "grammar");
    expect(faces.front).not.toContain("io ho andato"); // front omits the raw error
    expect(faces.correction).toBe("io sono andato"); // the retrieval target
    expect(faces.why).toBe("passato prossimo con essere");
    expect(faces.error).toBe("io ho andato"); // the error, once, for the back
  });
});
