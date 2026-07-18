import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlipHours } from "@/components/slip-hours";
import { slipHourDistribution, HOURS_IN_DAY } from "@/lib/slip-hours";

// The "when you slip" histogram at the render level (E-22 criterion 3): 24 quiet
// monochrome bars, the peak hour at full ink, never a spent green. renderToStaticMarkup
// — no DOM, no network. The bucket MATH is proven in slip-hours.test.

describe("SlipHours — a quiet monochrome distribution", () => {
  const distribution = slipHourDistribution([
    { sessionCreatedAt: "2026-01-01 09:00:00", startMs: 0 },
    { sessionCreatedAt: "2026-01-01 09:15:00", startMs: 0 },
    { sessionCreatedAt: "2026-01-01 14:00:00", startMs: 0 },
  ]);

  it("draws all 24 hour bars with their counts", () => {
    const html = renderToStaticMarkup(<SlipHours distribution={distribution} />);
    expect((html.match(/data-slip-hour=/g) ?? []).length).toBe(HOURS_IN_DAY);
    expect(html).toContain('data-slip-hour="9" data-count="2"');
    expect(html).toContain('data-slip-hour="14" data-count="1"');
    expect(html).toContain('data-slip-total="3"');
  });

  it("gives the peak hour full ink and never spends green", () => {
    const html = renderToStaticMarkup(<SlipHours distribution={distribution} />);
    expect(html).toContain("bg-ink"); // the peak bar
    expect(html).not.toContain("good"); // a slip is not a win — no green
  });
});
