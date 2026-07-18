import { describe, expect, it } from "vitest";
import { categoryCounts, segmentTally, CATEGORY_ORDER } from "@/lib/analysis-view";
import { formatUsd } from "@/lib/format";
import type { Category } from "@/lib/analysis-view";

// The pure view-model helpers behind the report (E-4 part 2): the per-category
// tally the counts row renders, and the money formatter for the estimate/budget.

function f(category: Category) {
  return { category };
}

describe("categoryCounts", () => {
  it("returns all five categories in display order, zero-filled", () => {
    const counts = categoryCounts([]);
    expect(counts.map((c) => c.category)).toEqual([...CATEGORY_ORDER]);
    expect(counts.every((c) => c.count === 0)).toBe(true);
  });

  it("tallies findings into the right category and leaves the rest at zero", () => {
    const counts = categoryCounts([f("grammar"), f("grammar"), f("idiom")]);
    const byCat = Object.fromEntries(counts.map((c) => [c.category, c.count]));
    expect(byCat.grammar).toBe(2);
    expect(byCat.idiom).toBe(1);
    expect(byCat.vocabulary).toBe(0);
    expect(byCat.phrasing).toBe(0);
    expect(byCat.pronunciation).toBe(0);
    // Total across categories equals the input length.
    expect(counts.reduce((s, c) => s + c.count, 0)).toBe(3);
  });
});

describe("formatUsd", () => {
  it("keeps three decimals for sub-dime amounts and two otherwise", () => {
    expect(formatUsd(0.004)).toBe("$0.004");
    expect(formatUsd(0.06)).toBe("$0.060");
    expect(formatUsd(1.2)).toBe("$1.20");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-3)).toBe("$0.00"); // never a negative label
  });
});

describe("segmentTally (E-16b criterion 4)", () => {
  // "No errors found" over 14 of 15 segments is a different claim from the same
  // words over all 15. A run that lost a segment has to say so.
  it("stays silent when every segment was read", () => {
    expect(segmentTally(15, 0)).toBeNull();
    expect(segmentTally(0, 0)).toBeNull();
  });

  it("reports how many of how many were analysed", () => {
    expect(segmentTally(15, 1)).toBe("14 of 15 segments analysed · 1 unreadable");
    expect(segmentTally(3, 3)).toBe("0 of 3 segments analysed · 3 unreadable");
  });
});
