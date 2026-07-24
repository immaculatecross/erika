import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SlipHours } from "@/components/slip-hours";
import { slipHourDistribution, HOURS_IN_DAY } from "@/lib/slip-hours";

// The "when you slip" histogram at the render level (E-22 criterion 3): 24 quiet
// monochrome bars, the peak hour at full ink, never a spent green. renderToStaticMarkup
// — no DOM, no network. The bucket MATH is proven in slip-hours.test.
//
// [E-38 / RETRO-003] The fixture's timestamps are unchanged; the buckets they land in
// are now the LEARNER'S LOCAL hours, so the zone is pinned (as in slip-hours.test)
// and the asserted indices move by the offset. Every original assertion survives, and
// one is added: the surface must no longer claim UTC to the user.

const tzBefore = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Rome"; // CET in January ⇒ +1
});
afterAll(() => {
  if (tzBefore === undefined) delete process.env.TZ;
  else process.env.TZ = tzBefore;
});

describe("SlipHours — a quiet monochrome distribution", () => {
  /** The same three fixtures as before: 09:00Z/09:15Z → 10:xx CET, 14:00Z → 15:00 CET. */
  const build = () =>
    slipHourDistribution([
      { sessionCreatedAt: "2026-01-01 09:00:00", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 09:15:00", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 14:00:00", startMs: 0 },
    ]);

  it("draws all 24 hour bars with their counts", () => {
    const html = renderToStaticMarkup(<SlipHours distribution={build()} />);
    expect((html.match(/data-slip-hour=/g) ?? []).length).toBe(HOURS_IN_DAY);
    expect(html).toContain('data-slip-hour="10" data-count="2"');
    expect(html).toContain('data-slip-hour="15" data-count="1"');
    expect(html).toContain('data-slip-total="3"');
  });

  it("gives the peak hour full ink and never spends green", () => {
    const html = renderToStaticMarkup(<SlipHours distribution={build()} />);
    expect(html).toContain("bg-ink"); // the peak bar
    expect(html).not.toContain("good"); // a slip is not a win — no green
  });

  it("no longer tells the learner the hours are UTC", () => {
    const html = renderToStaticMarkup(<SlipHours distribution={build()} />);
    expect(html).not.toContain("UTC");
    expect(html).toContain("your local time");
  });
});
