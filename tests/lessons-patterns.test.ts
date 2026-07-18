import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/analysis/findings";
import { derivePatterns, PATTERN_THRESHOLD, patternKey, parsePatternKey } from "@/lib/lessons/patterns";

// WO criterion 1 — pure pattern derivation. A category with >= threshold findings
// is a pattern carrying its example findings; fewer is not. Fixtures at, below,
// and above the threshold, plus the pattern-key round trip.

let seq = 0;
function finding(category: Finding["category"], quote = "q"): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    sessionId: "s1",
    contentHash: "h",
    quote,
    correction: "c",
    category,
    explanation: "e",
    severity: "low",
    startMs: 0,
    endMs: 0,
  };
}

function nOf(category: Finding["category"], n: number): Finding[] {
  return Array.from({ length: n }, () => finding(category));
}

describe("derivePatterns (criterion 1)", () => {
  it("requires the threshold: below is not a pattern, at/above is", () => {
    expect(PATTERN_THRESHOLD).toBe(3);
    const below = derivePatterns(nOf("grammar", PATTERN_THRESHOLD - 1));
    expect(below).toEqual([]);

    const at = derivePatterns(nOf("grammar", PATTERN_THRESHOLD));
    expect(at).toHaveLength(1);
    expect(at[0]).toMatchObject({ key: "category:grammar", category: "grammar", count: 3 });
    expect(at[0].findings).toHaveLength(3);

    const above = derivePatterns(nOf("vocabulary", PATTERN_THRESHOLD + 2));
    expect(above[0].count).toBe(5);
    expect(above[0].findings).toHaveLength(5);
  });

  it("returns only the categories that meet the threshold, in canonical order", () => {
    const findings = [...nOf("pronunciation", 4), ...nOf("grammar", 3), ...nOf("idiom", 1)];
    const patterns = derivePatterns(findings);
    // idiom (1) is dropped; grammar precedes pronunciation in CATEGORIES order.
    expect(patterns.map((p) => p.category)).toEqual(["grammar", "pronunciation"]);
  });

  it("each pattern carries exactly its own findings as source material", () => {
    const findings = [...nOf("grammar", 3), ...nOf("vocabulary", 3)];
    const patterns = derivePatterns(findings);
    for (const p of patterns) {
      expect(p.findings.every((f) => f.category === p.category)).toBe(true);
    }
  });

  it("round-trips a pattern key", () => {
    expect(patternKey("idiom")).toBe("category:idiom");
    expect(parsePatternKey("category:idiom")).toBe("idiom");
    expect(parsePatternKey("category:bogus")).toBeNull();
    expect(parsePatternKey("nonsense")).toBeNull();
  });
});
