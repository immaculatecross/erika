import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StreakLine } from "@/components/streak-line";
import { KnowledgeMap } from "@/components/knowledge-map";
import { streakCaption, repairLabel } from "@/lib/streak/caption";
import { computeStreak } from "@/lib/streak/compute";
import { previousLocalDay } from "@/lib/local-day";
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
    // [review F4] Sentence case, not the uppercase section-label token (DESIGN:53).
    expect(html).not.toContain("uppercase");
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

  it("renders the operator's example from the real computation: Day 14 · repaired Tue", () => {
    // 11–24 July with the 21st (a Tuesday) missed: a 14-day SPAN, 13 completed, one
    // bridged and disclosed. The number is the span; the disclosure keeps it honest.
    const completedDays = Array.from({ length: 14 }, (_, i) => `2026-07-${String(11 + i).padStart(2, "0")}`).filter(
      (d) => d !== "2026-07-21",
    );
    const streak = computeStreak({ completedDays, today: TODAY });
    expect(streak.currentRun).toBe(14);
    expect(completedDays).toHaveLength(13); // the run is 14 long; 13 days were done

    const html = renderToStaticMarkup(<StreakLine streak={streak} today={TODAY} />);
    expect(html).toContain("Day 14 · repaired Tue");
    expect(html).toContain('data-streak-run="14"');
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

  it("SUMMARISES a long repair list instead of enumerating it — nothing dropped", () => {
    // [review F2] Repairs accrue at 2/month with no cap on run length, so a committed
    // learner reaches double digits. Enumerating them would render a ~100-character
    // itemised list of every day they missed — not "a number and a word" (DESIGN:45),
    // and the closest this surface could come to a guilt ledger.
    const repairedDays = Array.from({ length: 12 }, (_, i) => ({
      localDay: `2026-0${1 + Math.floor(i / 2)}-${i % 2 === 0 ? "09" : "19"}`,
      chargedMonth: `2026-0${1 + Math.floor(i / 2)}`,
    }));
    const long = { currentRun: 162, repairedDays };

    const caption = streakCaption(long, TODAY)!;
    expect(caption).toBe("Day 162 · 12 repaired");
    // The DISCLOSED count accounts for every repair — nothing is silently dropped.
    expect(caption).toContain(String(repairedDays.length));
    expect(caption.length).toBeLessThanOrEqual(40); // stays a caption on a phone

    const html = renderToStaticMarkup(<StreakLine streak={long} today={TODAY} />);
    expect(html).toContain("12 repaired");
    // Still no guilt: the individual missed days are not itemised under the ring.
    expect(html).not.toContain("9 Jan");
    expect(html).not.toContain("19 Jan");
  });

  it("INVARIANT: a span wider than the days completed always discloses 'repaired'", () => {
    // The property the span reading depends on: `currentRun > completedDaysInRun` ⟹
    // the caption says "repaired". Under the span ruling the number INCLUDES days the
    // learner did not practise, so that disclosure is the only thing carrying D-19.
    //
    // GROUND TRUTH, NEVER THE OUTPUT. The completed count is derived from the INPUT
    // day set, never as `currentRun − repairedDays.length` — that form is the
    // tautology `x === (x − n) + n`, true for every input including wrong ones, and it
    // passed under a mutation that kept the span while emptying `repairedDays` (i.e.
    // the exact "inflated number with no disclosure" failure this case exists to
    // catch). The oracle below re-derives the run's window from `completedDays ∪
    // repairedDays` independently of anything `computeStreak` returned.
    const window = Array.from(
      { length: 20 },
      (_, i) => `2026-07-${String(5 + i).padStart(2, "0")}`,
    );
    const shapes: string[][] = [
      [], // a clean run — the shape that catches a silent +1
      ...window.map((d) => [d]), // every single-gap position
      [window[4], window[12]], // two gaps, both bridged
      [window[4], window[10], window[16]], // three gaps — the run ends at the third
      [window[8], window[9]], // two CONSECUTIVE misses — never bridged
    ];

    for (const missing of shapes) {
      const completedDays = window.filter((d) => !missing.includes(d));
      const streak = computeStreak({ completedDays, today: "2026-07-24" });
      const caption = streakCaption(streak, "2026-07-24");

      // Oracle: walk the run's window over the UNION of completed and repaired days,
      // from the input. An unfinished today is stepped over, not treated as a break.
      const inRun = new Set([...completedDays, ...streak.repairedDays.map((r) => r.localDay)]);
      const runDays: string[] = [];
      let cursor = "2026-07-24";
      if (!inRun.has(cursor)) cursor = previousLocalDay(cursor);
      while (inRun.has(cursor)) {
        runDays.push(cursor);
        cursor = previousLocalDay(cursor);
      }
      const completedInRun = runDays.filter((d) => completedDays.includes(d)).length;

      // 1. The span is exactly the run's length in calendar days.
      expect(streak.currentRun).toBe(runDays.length);
      // 2. …and is exactly the days done plus the days bridged.
      expect(streak.currentRun).toBe(completedInRun + streak.repairedDays.length);
      // 3. A number wider than the practice behind it MUST disclose the difference.
      if (streak.currentRun > completedInRun) {
        expect(caption).not.toBeNull();
        expect(caption!).toContain("repaired");
      }
      // 4. The run's last completed day is a day the learner really completed.
      if (streak.lastCompletedDay !== null) {
        expect(completedDays).toContain(streak.lastCompletedDay);
      }
    }
  });

  it("discloses the repair when the run's most recent day is itself repaired", () => {
    // The reviewer's pre-registered edge: 01–12 July completed, the 13th missed and
    // bridged, and today (the 14th) still in progress. The span reaches the bridged
    // day, so the number must be 13 AND the caption must say so.
    const completedDays = Array.from({ length: 12 }, (_, i) => `2026-07-${String(i + 1).padStart(2, "0")}`);
    const streak = computeStreak({ completedDays, today: "2026-07-14" });
    expect(streak.currentRun).toBe(13); // 12 completed + the bridged 13th
    expect(streak.lastCompletedDay).toBe("2026-07-12"); // their last real practice
    expect(streak.repairedDays).toEqual([{ localDay: "2026-07-13", chargedMonth: "2026-07" }]);
    const html = renderToStaticMarkup(<StreakLine streak={streak} today="2026-07-14" />);
    expect(html).toContain("Day 13 · repaired Mon"); // 2026-07-13 is a Monday
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
