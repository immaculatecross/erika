import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoalRing } from "@/components/goal-ring";

// The daily goal ring (E-31, D-24 / DESIGN "The daily ritual"). Rendered through the
// real component: ONE ring on a hairline track, closing with the accent (ink) — no
// second ring, no color fill. The centre carries the one number that matters.

function circleCount(html: string): number {
  return (html.match(/<circle/g) ?? []).length;
}

describe("GoalRing (DESIGN / D-24)", () => {
  it("draws exactly one ring on one hairline track — no second ring", () => {
    const html = renderToStaticMarkup(<GoalRing done={3} total={9} />);
    // A track circle + a single progress ring: two <circle>, never three.
    expect(circleCount(html)).toBe(2);
    // The track is the hairline; the progress ring is the accent ink.
    expect(html).toContain("text-hairline");
    expect(html).toContain("text-ink");
  });

  it("is stroke-only — no color fill anywhere (accent ink on a hairline track)", () => {
    const html = renderToStaticMarkup(<GoalRing done={3} total={9} />);
    // Both circles are fill:none — the ring is drawn, never filled (D-24).
    expect(html.match(/fill="none"/g)?.length).toBe(2);
    expect(html).not.toMatch(/fill="#|fill="rgb/);
  });

  it("shows the one number that matters, and flips data-complete only when closed", () => {
    const partial = renderToStaticMarkup(<GoalRing done={3} total={9} />);
    expect(partial).toContain("data-complete=\"false\"");
    expect(partial).toContain(">3<");
    expect(partial).toContain("of 9");

    const closed = renderToStaticMarkup(<GoalRing done={9} total={9} />);
    expect(closed).toContain("data-complete=\"true\"");
  });

  it("an empty day leaves the ring open (no false completion)", () => {
    const html = renderToStaticMarkup(<GoalRing done={0} total={0} />);
    expect(html).toContain("data-complete=\"false\"");
  });
});
