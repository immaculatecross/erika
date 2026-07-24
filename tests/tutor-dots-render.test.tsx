import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DotsField } from "@/components/tutor/dots-field";

// The tutor surface (E-34, D-24 / DESIGN "The daily ritual" → "The tutor surface"): a
// quiet field of small accent-colored dots — NO avatar, NO face, NO waveform. This
// asserts the surface is exactly that: only dots, in the accent, and none of the
// banned theatrics.

function dotCount(html: string): number {
  return (html.match(/rounded-full bg-accent/g) ?? []).length;
}

describe("DotsField (D-24 — the tutor surface)", () => {
  it("renders a field of accent dots, marked as the tutor surface", () => {
    const html = renderToStaticMarkup(<DotsField active={false} />);
    expect(html).toContain("data-tutor-dots");
    expect(dotCount(html)).toBeGreaterThanOrEqual(24); // a field of small dots
  });

  it("has no avatar, face, or waveform theatrics — only dots", () => {
    const html = renderToStaticMarkup(<DotsField active intensity={0.8} />);
    expect(html).not.toMatch(/<canvas|<img|<video|<path|<polyline|waveform|avatar/i);
  });

  it("reflects the live state on the surface (dots brighten when active)", () => {
    const idle = renderToStaticMarkup(<DotsField active={false} />);
    const live = renderToStaticMarkup(<DotsField active intensity={0.9} />);
    expect(idle).toContain('data-active="false"');
    expect(live).toContain('data-active="true"');
  });
});
