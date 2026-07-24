import { describe, expect, it } from "vitest";
import {
  scorePlacement,
  recognizedItemIds,
  BANDS,
  RECOGNITION_THRESHOLD,
  type Band,
  type PlacementAnswer,
} from "@/lib/placement/scoring";
import { buildPlacementCheck } from "@/lib/placement/check";
import { PSEUDOWORDS } from "@/lib/placement/pseudowords";
import { attestsLemma } from "@/lib/lexicon/morphit";
import { POS_TAGS } from "@/lib/lexicon/pos";

// The placement vocabulary scoring (E-35, D-13). A PURE function — the whole
// milestone's psychometric honesty lives here, so it is exercised with hand-built
// fixtures: a pure-guesser must not read as advanced, a realistic responder must
// recover the band they know, and the false-alarm correction must measurably move
// the estimate. Plus the D-13 guarantee that the pseudowords are genuinely non-words.

/** Build `n` real answers for a band, `known` for all. */
function reals(band: Band, n: number, known: boolean): PlacementAnswer[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: "real" as const,
    band,
    itemId: `lemma:w${band}${i}#NOUN`,
    known,
  }));
}
/** Build real answers for a band with a given fraction known (rounded). */
function realsFrac(band: Band, n: number, fracKnown: number): PlacementAnswer[] {
  const k = Math.round(n * fracKnown);
  return Array.from({ length: n }, (_, i) => ({
    kind: "real" as const,
    band,
    itemId: `lemma:w${band}${i}#NOUN`,
    known: i < k,
  }));
}
function pseudos(n: number, known: boolean): PlacementAnswer[] {
  return Array.from({ length: n }, () => ({ kind: "pseudo" as const, known }));
}

describe("scorePlacement — the pure-guesser (criterion 1)", () => {
  it("a learner who says yes to EVERYTHING (incl. pseudowords) scores ~0, not advanced", () => {
    const answers = [
      ...BANDS.flatMap((b) => reals(b, 8, true)),
      ...pseudos(16, true), // yes to every non-word → false-alarm rate 1
    ];
    const r = scorePlacement(answers);
    expect(r.falseAlarmRate).toBe(1);
    // Every band's corrected recognition collapses to 0 — no band is "reliably known".
    expect(r.bands.every((b) => b.corrected === 0)).toBe(true);
    expect(r.level).toBeNull(); // NOT C2
  });
});

describe("scorePlacement — a realistic responder recovers the seeded band (criterion 1)", () => {
  it("knows A1–B1, rejects the rest and the non-words → level B1", () => {
    const answers = [
      ...reals("A1", 8, true),
      ...reals("A2", 8, true),
      ...reals("B1", 8, true),
      ...reals("B2", 8, false),
      ...reals("C1", 8, false),
      ...reals("C2", 8, false),
      ...pseudos(16, false), // correctly rejects non-words → fa 0
    ];
    const r = scorePlacement(answers);
    expect(r.falseAlarmRate).toBe(0);
    expect(r.level).toBe("B1");
    expect(r.calibrated).toBe(true);
    // Corrected == raw when fa is 0.
    expect(r.bands.find((b) => b.band === "B1")!.corrected).toBe(1);
    expect(r.bands.find((b) => b.band === "B2")!.corrected).toBe(0);
  });
});

describe("scorePlacement — false-alarm correction moves the estimate (criterion 1)", () => {
  // Same hit rates, two false-alarm rates. Without correction B1 (hit 0.7) clears
  // the 0.5 threshold; with fa 0.5 it drops below it and the level falls to A2.
  const hits = [
    ...reals("A1", 8, true), // 1.0
    ...realsFrac("A2", 10, 0.9), // 0.9
    ...realsFrac("B1", 10, 0.7), // 0.7
    ...reals("B2", 8, false), // 0
    ...reals("C1", 8, false),
    ...reals("C2", 8, false),
  ];

  it("no false alarms → the raw hit rate stands (level B1)", () => {
    const r = scorePlacement([...hits, ...pseudos(16, false)]);
    expect(r.level).toBe("B1");
    expect(r.bands.find((b) => b.band === "B1")!.corrected).toBeCloseTo(0.7, 5);
  });

  it("a yes-biased responder (fa 0.5) is corrected DOWN → level A2", () => {
    // Deterministic fa 0.5: 8 of 16 non-words marked known.
    const withFa = scorePlacement([...hits, ...pseudos(8, true), ...pseudos(8, false)]);
    expect(withFa.falseAlarmRate).toBeCloseTo(0.5, 5);
    const b1 = withFa.bands.find((b) => b.band === "B1")!;
    expect(b1.corrected).toBeCloseTo((0.7 - 0.5) / 0.5, 5); // 0.4 — below threshold
    expect(b1.corrected).toBeLessThan(b1.hitRate); // correction moved it DOWN
    expect(withFa.level).toBe("A2"); // fell from B1
  });

  it("the correction never invents recognition: threshold is a shared constant", () => {
    expect(RECOGNITION_THRESHOLD).toBeGreaterThan(0);
    expect(RECOGNITION_THRESHOLD).toBeLessThan(1);
  });
});

describe("scorePlacement — thin samples degrade truthfully (criterion 1)", () => {
  it("marks the result uncalibrated when there are too few pseudowords/band items", () => {
    const r = scorePlacement([...reals("A1", 2, true), ...pseudos(2, false)]);
    expect(r.calibrated).toBe(false); // below MIN_PSEUDO / MIN_PER_BAND
    // A level is still offered (honest best guess), just flagged uncalibrated.
    expect(r.level).toBe("A1");
  });
});

describe("recognizedItemIds — only genuinely-known real words (criterion 2)", () => {
  it("returns the item ids of real words marked known, never pseudowords", () => {
    const answers: PlacementAnswer[] = [
      { kind: "real", band: "A1", itemId: "lemma:casa#NOUN", known: true },
      { kind: "real", band: "A1", itemId: "lemma:xyz#NOUN", known: false }, // not known → excluded
      { kind: "pseudo", known: true }, // never seeded
    ];
    expect(recognizedItemIds(answers)).toEqual(["lemma:casa#NOUN"]);
  });
});

describe("pseudowords are genuine non-words (D-13)", () => {
  it("no pseudoword is attested by morph-it in ANY part of speech", () => {
    const attestedSomewhere = PSEUDOWORDS.filter((w) => POS_TAGS.some((pos) => attestsLemma(w, pos)));
    expect(attestedSomewhere).toEqual([]);
  });
  it("the list is modest and unique", () => {
    expect(new Set(PSEUDOWORDS).size).toBe(PSEUDOWORDS.length);
    expect(PSEUDOWORDS.length).toBeGreaterThanOrEqual(30);
    expect(PSEUDOWORDS.length).toBeLessThanOrEqual(80);
  });
});

describe("buildPlacementCheck — samples every band + weaves in pseudowords (criterion 1)", () => {
  it("returns real words per band (with lemma ids) and pseudowords, deterministic by seed", () => {
    const check = buildPlacementCheck({ perBand: 6, pseudoCount: 12, seed: 42 });
    const reals = check.filter((c) => c.kind === "real");
    const pseudo = check.filter((c) => c.kind === "pseudo");
    expect(pseudo).toHaveLength(12);
    // Every band is represented, each real item carries a lemma item id and a band.
    for (const band of BANDS) {
      const inBand = reals.filter((c) => c.band === band);
      expect(inBand.length).toBe(6);
      expect(inBand.every((c) => c.itemId?.startsWith("lemma:"))).toBe(true);
    }
    // Deterministic: same seed → same words in the same order.
    const again = buildPlacementCheck({ perBand: 6, pseudoCount: 12, seed: 42 });
    expect(again.map((c) => c.word)).toEqual(check.map((c) => c.word));
  });
});
