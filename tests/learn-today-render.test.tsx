import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LearnToday } from "@/components/learn-today";
import { ONBOARDING_PATH } from "@/lib/onboarding/routing";
import type { TodayView } from "@/lib/today";

// CRITERION 1 — ONE SCREEN, ONE ACTION (E-44, D-24/D-26).
//
// The Learn home used to render seven sections and up to thirteen actionable rows.
// This file counts the interactive elements in the real component's markup, so a row
// cannot come back without a test going red. It is the whole point of the home being
// a pure, prop-driven component: the old page was a client component with its fetch
// inline, and 335 lines of product decisions had no unit coverage at all.

// [E-46] The goal section is stripped before counting, and this is a narrowing of the
// assertion, so it is argued rather than done quietly. E-46 makes the ring the way in
// to "what Erika knows about you" — the ring already stands for the whole of your
// progress, so it is the affordance that costs the home screen no new row, no new
// label and no new pixel. What E-44 was defending is that the home TELLS you to do
// exactly one thing, and that is still counted exactly as before: everything outside
// the ring's own section. A second instructing row still turns this red.
function stripGoalSection(html: string): string {
  return html.replace(/<section\b[^>]*data-today-goal[\s\S]*?<\/section>/g, "");
}
function anchors(html: string): number {
  return (html.match(/<a\b/g) ?? []).length;
}
function buttons(html: string): number {
  return (html.match(/<button\b/g) ?? []).length;
}
function interactive(html: string): number {
  const outside = stripGoalSection(html);
  return anchors(outside) + buttons(outside);
}

const BASE: TodayView = {
  day: "2026-07-25",
  goal: { done: 0, total: 3 },
  complete: false,
  completion: null,
  summary: "A lesson on the congiuntivo, 12 cards, and a conversation.",
  steps: ["lesson", "drills", "conversation"],
  action: { kind: "start", href: "/practice/session", label: "Start today" },
  placed: true,
  streak: { currentRun: 0, repairedDays: [], lastCompletedDay: null },
  thread: null,
};

describe("the main column holds exactly one tappable thing", () => {
  it("offers one control before the session is started", () => {
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    expect(interactive(html)).toBe(1);
    expect(html).toContain('data-primary-action="start"');
    expect(html).toContain("Start today");
  });

  it("offers one control while it is in progress", () => {
    const html = renderToStaticMarkup(
      <LearnToday
        view={{ ...BASE, goal: { done: 1, total: 3 }, action: { kind: "continue", href: "/practice/session", label: "Continue" } }}
      />,
    );
    expect(interactive(html)).toBe(1);
    expect(html).toContain('data-primary-action="continue"');
  });

  it("offers NOTHING once the day is done — the sentence is the whole surface", () => {
    const html = renderToStaticMarkup(
      <LearnToday
        view={{
          ...BASE,
          goal: { done: 3, total: 3 },
          complete: true,
          completion: { cardsDone: 12, lessonsDone: 1, conversation: true },
          action: { kind: "none" },
        }}
      />,
    );
    expect(interactive(html)).toBe(0);
    expect(html).toContain("Done for today. One lesson, 12 cards, and a conversation.");
  });

  it("asks an unplaced learner for their level — still exactly one control", () => {
    const html = renderToStaticMarkup(
      <LearnToday
        view={{ ...BASE, placed: false, action: { kind: "place", href: ONBOARDING_PATH, label: "Find your level" } }}
      />,
    );
    expect(interactive(html)).toBe(1);
    expect(html).toContain(ONBOARDING_PATH);
  });
});

describe("none of the thirteen rows came back", () => {
  it("renders no review row, tutor row, lesson row, new-items row, sounds row or letter row", () => {
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    for (const gone of [
      "data-today-cards",
      "data-start-practice",
      "data-today-tutor",
      "data-open-tutor",
      "data-today-lesson",
      "data-lesson-price",
      "data-today-new",
      "data-today-new-items",
      "data-today-new-sounds",
      "data-today-letter",
      "data-today-map",
      "data-browse-cards",
      "data-work-on-pattern",
      "data-open-reading",
      "data-open-shadow",
      "data-open-studio",
    ]) {
      expect(html, gone).not.toContain(gone);
    }
  });

  it("makes no promise about sounds coming back through lines below", () => {
    // The standing lie criterion 8 names: a return no code path implements.
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    expect(html.toLowerCase()).not.toContain("at your edge");
    expect(html.toLowerCase()).not.toContain("come back through");
  });
});

describe("the ring, the streak and the one factual line (D-24)", () => {
  it("draws exactly one ring", () => {
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    expect((html.match(/<circle/g) ?? []).length).toBe(2); // track + progress
  });

  it("states what today holds, once", () => {
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    expect(html).toContain("A lesson on the congiuntivo, 12 cards, and a conversation.");
  });

  it("renders NOTHING for a run of zero — no nag, no countdown", () => {
    const html = renderToStaticMarkup(<LearnToday view={BASE} />);
    expect(html).not.toContain("data-streak");
  });

  it("keeps the repair disclosure when there is a run", () => {
    const html = renderToStaticMarkup(
      <LearnToday
        view={{
          ...BASE,
          day: "2026-07-25",
          streak: {
            currentRun: 14,
            repairedDays: [{ localDay: "2026-07-21", chargedMonth: "2026-07" }],
            lastCompletedDay: "2026-07-25",
          },
        }}
      />,
    );
    expect(html).toContain("Day 14");
    expect(html.toLowerCase()).toContain("repaired");
  });

  it("carries none of D-24's banned ornaments", () => {
    const html = renderToStaticMarkup(
      <LearnToday
        view={{
          ...BASE,
          goal: { done: 3, total: 3 },
          complete: true,
          completion: { cardsDone: 12, lessonsDone: 1, conversation: true },
          action: { kind: "none" },
          streak: { currentRun: 14, repairedDays: [], lastCompletedDay: "2026-07-25" },
        }}
      />,
    );
    for (const banned of [
      "confetti", "trophy", "badge", "xp", "points", "level up", "leaderboard",
      "flame", "🔥", "🎉", "at risk", "countdown", "expires", "streak freeze",
    ]) {
      expect(html.toLowerCase(), banned).not.toContain(banned);
    }
  });

  it("cites a real production event only alongside the completion beat", () => {
    const thread = { itemId: "lemma:magari#ADV", label: "magari", partOfDay: "this morning" as const };
    const open = renderToStaticMarkup(<LearnToday view={{ ...BASE, thread }} />);
    expect(open).not.toContain("data-today-thread");

    const done = renderToStaticMarkup(
      <LearnToday
        view={{
          ...BASE,
          complete: true,
          completion: { cardsDone: 1, lessonsDone: 1, conversation: false },
          action: { kind: "none" },
          thread,
        }}
      />,
    );
    expect(done).toContain("data-today-thread");
    expect(done).toContain("magari");
  });
});
