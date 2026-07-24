import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreakLine } from "@/components/streak-line";
import { KnowledgeMap } from "@/components/knowledge-map";
import { streakCaption, repairLabel } from "@/lib/streak/caption";
import { buildMapCells } from "@/lib/knowledge-map";

// E-38 criterion 2 (DESIGN.md:42-49, D-24). The streak's rendered surface is one
// caption line and nothing else. D-24's ban list has NO automated tripwire, so this
// file is the closest thing to one: it asserts the rendered markup carries no
// celebration, no trophy vocabulary, no loss-aversion pressure and no alarm colour,
// and that a zero run renders literally nothing.

const RUN = { currentRun: 14, repairedDays: [] as { localDay: string; chargedMonth: string }[] };
const TODAY = "2026-07-24"; // a Friday

/** Words and tokens D-24 bans outright, plus the alarm/celebration design tokens. */
const BANNED = [
  "confetti",
  "trophy",
  "badge",
  "streak freeze",
  "don't break",
  "keep it up",
  "xp",
  "points",
  "level up",
  "leaderboard",
  "flame",
  "🔥",
  "🎉",
  "at risk",
  "countdown",
  "expires",
  "you'll lose",
  "text-severe", // no red / alarm styling on a missed day
  "bg-severe",
  "text-medium",
  "animate-", // no celebratory animation utility
];

describe("the streak caption — 'Day 14', and nothing more", () => {
  it("is a number and a word, caption style", () => {
    expect(streakCaption(RUN, TODAY)).toBe("Day 14");
    const html = renderToStaticMarkup(<StreakLine streak={RUN} today={TODAY} />);
    expect(html).toContain("Day 14");
    expect(html).toContain('data-streak-run="14"');
    expect(html).toContain("text-secondary"); // caption style, not a headline
  });

  it("acknowledges a repair factually — 'repaired Tue'", () => {
    const withRepair = {
      currentRun: 14,
      repairedDays: [{ localDay: "2026-07-21", chargedMonth: "2026-07" }],
    };
    expect(streakCaption(withRepair, TODAY)).toBe("Day 14 · repaired Tue");
    const html = renderToStaticMarkup(<StreakLine streak={withRepair} today={TODAY} />);
    expect(html).toContain("repaired Tue");
    // Not an apology, not a warning, not a purchase.
    expect(html.toLowerCase()).not.toContain("sorry");
    expect(html.toLowerCase()).not.toContain("used one");
    expect(html.toLowerCase()).not.toContain("remaining");
  });

  it("names an older repair by date rather than a stale weekday", () => {
    expect(repairLabel("2026-07-21", TODAY)).toBe("Tue"); // within the week
    expect(repairLabel("2026-07-02", TODAY)).toBe("2 Jul"); // older than a week
  });

  it("lists both repairs when a run stands on two — never overstating continuity", () => {
    const two = {
      currentRun: 18,
      repairedDays: [
        { localDay: "2026-07-21", chargedMonth: "2026-07" },
        { localDay: "2026-07-10", chargedMonth: "2026-07" },
      ],
    };
    expect(streakCaption(two, TODAY)).toBe("Day 18 · repaired Tue, 10 Jul");
  });

  it("renders NOTHING for a zero run — no nag, no warning, no 'start a streak'", () => {
    expect(streakCaption({ currentRun: 0, repairedDays: [] }, TODAY)).toBeNull();
    const html = renderToStaticMarkup(<StreakLine streak={{ currentRun: 0, repairedDays: [] }} today={TODAY} />);
    expect(html).toBe("");
  });

  it("carries none of D-24's banned mechanics, and never spends green on attendance", () => {
    const html = renderToStaticMarkup(
      <StreakLine
        streak={{ currentRun: 14, repairedDays: [{ localDay: "2026-07-21", chargedMonth: "2026-07" }] }}
        today={TODAY}
      />,
    ).toLowerCase();
    for (const banned of BANNED) expect(html).not.toContain(banned);
    // Showing up is not mastery: `good` (#34C759) is reserved for resolved slips.
    expect(html).not.toContain("good");
    // And the repair credit BALANCE is never surfaced — a countdown is pressure.
    for (const phrase of ["of 2", "1 of", "left", "repairs used", "credit"]) {
      expect(html).not.toContain(phrase);
    }
  });
});

describe("the map strip — green is mastery, never activity (criterion 3, render)", () => {
  it("tints a category with resolved slips and leaves a busy-but-unresolved one neutral", () => {
    const cells = buildMapCells([
      // grammar: lots of ACTIVITY, nothing resolved.
      ...Array.from({ length: 9 }, () => ({ category: "grammar" as const, state: "active" })),
      { category: "grammar" as const, state: "remission" },
      // vocabulary: every slip resolved.
      { category: "vocabulary" as const, state: "resolved" },
      { category: "vocabulary" as const, state: "resolved" },
    ]);
    const html = renderToStaticMarkup(<KnowledgeMap cells={cells} />);

    const grammarCell = html.slice(html.indexOf('data-map-cell="grammar"'), html.indexOf('data-map-cell="vocabulary"'));
    expect(grammarCell).toContain('data-band="0"');
    expect(grammarCell).toContain("bg-hairline");
    expect(grammarCell).not.toContain("good"); // ← the whole point: activity is not green

    const vocabCell = html.slice(html.indexOf('data-map-cell="vocabulary"'));
    expect(vocabCell).toContain('data-band="4"');
    expect(vocabCell).toContain("bg-good");
  });

  it("stays quiet: no scores, no badges, no celebration, no red", () => {
    const cells = buildMapCells([{ category: "idiom" as const, state: "resolved" }]);
    const html = renderToStaticMarkup(<KnowledgeMap cells={cells} />).toLowerCase();
    for (const banned of BANNED) expect(html).not.toContain(banned);
    expect(html).not.toContain("%"); // no score
  });
});
