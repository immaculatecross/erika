import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRow } from "@/components/session-row";
import type { SessionListItem } from "@/lib/sessions-list-view";

// E-18 criterion 3, at the render level: an unanalyzed session LOOKS unanalyzed
// and carries the inline Analyze affordance; sessions the analysis route would
// refuse (ingest failed, no segments, run in flight) show their truthful state
// and never a dead or lying button. Rendered without a DOM (no effects, no
// fetch), the same technique as tests/analysis-panel-render.test.tsx.

function item(over: Partial<SessionListItem>): SessionListItem {
  return {
    id: "s1",
    originalFilename: "monday.wav",
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 3600,
    createdAt: "2026-07-13 09:00:00",
    jobState: "done",
    segmentCount: 2,
    analysed: false,
    analysisPending: false,
    sessionYield: null,
    ...over,
  };
}

const render = (i: SessionListItem) => renderToStaticMarkup(<SessionRow item={i} onStarted={() => {}} />);

describe("SessionRow (criteria 2–3)", () => {
  it("an analysed row states its yield and offers no Analyze", () => {
    const html = render(
      item({
        analysed: true,
        sessionYield: { analysedSpeechMs: 3_600_000, findingsCount: 4, dominantCategory: "grammar" },
      }),
    );
    expect(html).toContain('data-gate="analysed"');
    expect(html).toContain("1:00:00 speech analysed · 4 findings · mostly grammar");
    expect(html).not.toContain("data-inline-analyze");
    expect(html).not.toContain("Not analyzed yet");
  });

  it("an unanalyzed row is visually distinct and carries the inline affordance", () => {
    const html = render(item({}));
    expect(html).toContain('data-gate="analyze"');
    expect(html).toContain("Not analyzed yet");
    expect(html).toContain("border-dashed"); // the outline, not a filled card
    expect(html).toContain("data-inline-analyze");
  });

  it("a failed ingest shows Failed and no affordance — the 409 states, mirrored", () => {
    const failed = render(item({ jobState: "failed" }));
    expect(failed).toContain('data-gate="ingest-failed"');
    expect(failed).toContain("Failed");
    expect(failed).not.toContain("data-inline-analyze");

    const empty = render(item({ segmentCount: 0 }));
    expect(empty).toContain('data-gate="no-segments"');
    expect(empty).toContain("No speech found");
    expect(empty).not.toContain("data-inline-analyze");

    const pending = render(item({ jobState: "queued" }));
    expect(pending).toContain('data-gate="ingest-pending"');
    expect(pending).not.toContain("data-inline-analyze");
  });

  it("a run in flight reads as running, never a second Analyze press", () => {
    const html = render(item({ analysisPending: true }));
    expect(html).toContain('data-gate="running"');
    expect(html).toContain("Analyzing…");
    expect(html).not.toContain("data-inline-analyze");
  });
});
