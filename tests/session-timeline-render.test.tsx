import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SegmentTimeline } from "@/components/segment-timeline";
import { SEVERITY_STYLES } from "@/lib/analysis-view";
import type { TimelineSegment } from "@/lib/ingest-view";
import type { FindingMarkerInput } from "@/lib/session-map";

// The session map at the render level (E-22 criterion 1/2): a marker per finding,
// tinted by the SHARED SEVERITY_STYLES, sitting on the right segment, with the
// selection state observable on the markup. Rendered with renderToStaticMarkup —
// no DOM, no network. The marker→segment MATH is proven purely in session-map.test;
// this proves the component renders it.

const segments: TimelineSegment[] = [
  { idx: 0, startMs: 0, endMs: 1000, durationMs: 1000 },
  { idx: 1, startMs: 5000, endMs: 6000, durationMs: 1000 },
];

const findings: FindingMarkerInput[] = [
  { id: "f-high", startMs: 500, severity: "high" },
  { id: "f-low", startMs: 5500, severity: "low" },
];

function render(over: Partial<Parameters<typeof SegmentTimeline>[0]> = {}): string {
  return renderToStaticMarkup(
    <SegmentTimeline
      segments={segments}
      totalMs={6000}
      selectedIdx={null}
      onSelect={() => {}}
      findings={findings}
      onSelectFinding={() => {}}
      {...over}
    />,
  );
}

const markerCount = (html: string) => (html.match(/data-finding-marker/g) ?? []).length;

describe("SegmentTimeline — the session map", () => {
  it("draws one marker per finding, tinted by the shared severity style", () => {
    const html = render();
    expect(markerCount(html)).toBe(2);
    // High reads red (bg-severe), low reads neutral (bg-secondary) — the shared map.
    expect(html).toContain(SEVERITY_STYLES.high.dot);
    expect(html).toContain(SEVERITY_STYLES.low.dot);
    expect(html).toContain('data-marker-finding-id="f-high"');
    expect(html).toContain('data-marker-severity="high"');
  });

  it("places each marker on the segment its timestamp falls in", () => {
    const html = render();
    // f-high at 500ms → segment 0; f-low at 5500ms → segment 1.
    expect(html).toMatch(/data-marker-finding-id="f-high"[^>]*data-marker-segment-idx="0"/);
    expect(html).toMatch(/data-marker-finding-id="f-low"[^>]*data-marker-segment-idx="1"/);
  });

  it("reflects the selection on the marker markup", () => {
    const html = render({ highlightedFindingIds: new Set(["f-high"]) });
    // The selected marker is aria-pressed; the other is not.
    expect(html).toMatch(/data-marker-finding-id="f-high"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/data-marker-finding-id="f-low"[^>]*aria-pressed="false"/);
  });

  it("draws no markers — and no broken map — when there are no findings", () => {
    const html = render({ findings: [] });
    expect(markerCount(html)).toBe(0);
    expect(html).toContain("data-segment-timeline"); // the bare timeline still renders
  });

  it("never spends green on a severity marker (D-14)", () => {
    const html = render();
    expect(html).not.toContain("good"); // no bg-good / text-good anywhere on the map
  });
});
