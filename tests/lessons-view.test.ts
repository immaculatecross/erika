import { describe, expect, it } from "vitest";
import {
  checkFillIn,
  lessonScore,
  masteryPercent,
  normalizeAnswer,
} from "@/lib/lessons/lessons-view";

// The pure client-safe helpers the lesson runner leans on (E-6b). Fill-in matching
// is deterministic and forgiving (documented tolerance), and the completion score
// / mastery-percent math match the engine's contract so the runner posts and shows
// the right numbers.

describe("checkFillIn", () => {
  it("matches ignoring case and surrounding/inner whitespace", () => {
    expect(checkFillIn("goes", "goes")).toBe(true);
    expect(checkFillIn("goes", "  Goes ")).toBe(true);
    expect(checkFillIn("has been", "has   been")).toBe(true);
    expect(checkFillIn("goes", "go")).toBe(false);
    expect(checkFillIn("goes", "")).toBe(false);
  });

  it("normalizeAnswer collapses case and whitespace", () => {
    expect(normalizeAnswer("  He   Goes  ")).toBe("he goes");
  });
});

describe("lessonScore", () => {
  it("is the fraction correct, and never divides by zero", () => {
    expect(lessonScore(3, 3)).toBe(1);
    expect(lessonScore(0, 4)).toBe(0);
    expect(lessonScore(1, 2)).toBe(0.5);
    expect(lessonScore(0, 0)).toBe(0);
  });
});

describe("masteryPercent", () => {
  it("rounds a 0..1 mastery to an integer percent", () => {
    expect(masteryPercent(0)).toBe(0);
    expect(masteryPercent(0.5)).toBe(50);
    expect(masteryPercent(0.756)).toBe(76);
    expect(masteryPercent(1)).toBe(100);
  });
});
