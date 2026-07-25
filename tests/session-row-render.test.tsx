import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRow } from "@/components/session-row";
import { CATEGORIES } from "@/lib/analysis/findings";
import type { SessionListItem } from "@/lib/sessions-list-view";

// The sessions row at the RENDER level (E-42 criteria 1–2).
//
// The point of driving the real component rather than reading the source: criterion
// 2 says a session row must offer NO analysis control, and the only honest way to
// assert "no control" is to render the DOM and count what is interactive. A source
// grep for `data-inline-analyze` would pass on a renamed button; this does not.
//
// Rendered without a DOM (no effects, no fetch), the same technique as
// tests/analysis-panel-render.test.tsx.

function item(over: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: "s1",
    originalFilename: "monday.wav",
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 3600,
    createdAt: "2026-07-13 21:30:00",
    capturedAt: "2026-07-13 08:10:00",
    jobState: "done",
    excludeFromEvidence: false,
    segmentCount: 2,
    analysed: false,
    sessionYield: null,
    ingestStage: null,
    ingestError: null,
    analysisState: "idle",
    analysisProgress: 0,
    analysisError: null,
    workerAbsent: false,
    analysisNeedsKey: false,
    ...over,
  };
}

const render = (i: SessionListItem) => renderToStaticMarkup(<SessionRow item={i} />);

/** Every element a person could press or activate inside the rendered row. */
function interactiveCount(html: string): number {
  return (html.match(/<(button|input|select|textarea)\b/g) ?? []).length;
}

describe("SessionRow — no analysis control anywhere on the path (criterion 2)", () => {
  it("an ingested, unanalysed session offers NOTHING to press", () => {
    const html = render(item());
    // The exact state that used to carry "Analyze": ingest done, speech found, no
    // findings yet. Counting interactive elements is the assertion — not the absence
    // of one attribute name, which a rename would defeat.
    expect(html).toContain('data-phase="analysis-queued"');
    expect(interactiveCount(html)).toBe(0);
    expect(html).not.toMatch(/Analyze/i);
    expect(html).not.toContain("data-inline-analyze");
    expect(html).toContain("Waiting to be listened to");
  });

  it("carries no money — not an estimate, not a total, not a currency symbol", () => {
    // Criterion 7: five cost surfaces left this path. A row that reintroduces one
    // fails here rather than in a review.
    for (const i of [
      item(),
      item({ analysisState: "processing", analysisProgress: 0.5 }),
      item({ analysed: true, sessionYield: { findingsCount: 3, dominantCategory: "grammar", segmentCount: 2, analysedSegmentCount: 2 } }),
      item({ analysisState: "halted" }),
    ]) {
      const html = render(i);
      expect(html).not.toMatch(/\$|USD|est\.|budget remaining/i);
    }
  });

  it("an analysed row states its yield and is a finished card", () => {
    const html = render(
      item({
        analysed: true,
        sessionYield: { findingsCount: 4, dominantCategory: "grammar", segmentCount: 2, analysedSegmentCount: 2 },
      }),
    );
    expect(html).toContain('data-phase="analysed"');
    expect(html).toContain("4 mistakes · mostly grammar");
    expect(html).toContain("shadow-card");
    expect(html).not.toContain("border-dashed");
    expect(interactiveCount(html)).toBe(0);
  });

  it("qualifies a partial run rather than reading as a clean bill of health", () => {
    // The budget cap stops a run mid-way and the session is still `analysed`. "No
    // mistakes found" over 1 of 15 segments is a different claim from the same words
    // over all 15 (E-16b criterion 4) — and this milestone, which makes runs
    // automatic, is what puts that state on the home screen.
    const html = render(
      item({
        analysed: true,
        sessionYield: { findingsCount: 0, dominantCategory: null, segmentCount: 15, analysedSegmentCount: 1 },
      }),
    );
    expect(html).toContain("No mistakes found · heard 1 of 15");
  });

  it("shows the CAPTURE time, not the upload instant", () => {
    // Recorded 08:10, uploaded 21:30 (criterion 6). The row's date line must be the
    // morning one; if it ever shows 21:30 again the fix has been undone.
    const html = render(item());
    const morning = new Date("2026-07-13T08:10:00Z").toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(html).toContain(morning);
  });
});

describe("SessionRow — every phase says its own true thing", () => {
  it("an in-flight ingest names its stage and marks itself unfinished", () => {
    const html = render(item({ jobState: "processing", ingestStage: "detecting" }));
    expect(html).toContain('data-phase="ingesting"');
    expect(html).toContain('data-in-flight="true"');
    expect(html).toContain("Finding the speech");
    expect(html).toContain("border-dashed");
  });

  it("never states a percentage for ingest, whose progress is a checkpoint not a measurement", () => {
    const html = render(item({ jobState: "processing", ingestStage: "detecting" }));
    expect(html).not.toMatch(/\d+%/);
  });

  it("draws a bar only for the analysis run, whose ratio is real work completed", () => {
    const listening = render(item({ analysisState: "processing", analysisProgress: 0.25 }));
    expect(listening).toContain('data-phase="analysing"');
    expect(listening).toContain("data-analysis-bar");
    expect(listening).toContain("scaleX(0.25)");
    expect(render(item({ jobState: "processing" }))).not.toContain("data-analysis-bar");
  });

  it("a failed ingest shows its own stored reason, not the analysis job's", () => {
    const html = render(
      item({ jobState: "failed", ingestError: "ffmpeg could not read this file", analysisError: "unrelated" }),
    );
    expect(html).toContain('data-phase="ingest-failed"');
    expect(html).toContain("ffmpeg could not read this file");
    expect(html).not.toContain("unrelated");
  });

  it("a missing key is described as permanent and points at the fix", () => {
    // Criterion 9: never "unavailable right now" for a condition nothing changes on
    // its own — and never a dead end, which is what RETRO-004 found thirteen times.
    const html = render(item({ analysisState: "failed", analysisNeedsKey: true }));
    expect(html).toContain('data-phase="needs-key"');
    expect(html).toMatch(/Waiting for an API key/);
    expect(html).not.toMatch(/right now|just now|temporarily/i);
    expect(html).toContain('href="/settings"');
  });

  it("a capped run says it is held, links to Settings, and is still in flight", () => {
    // Criterion 8: the cap HOLDS a session, it never fails one — and the worker
    // resumes it, so it is not a terminal state the learner has to rescue.
    const html = render(item({ analysisState: "halted", analysisError: "Monthly budget reached." }));
    expect(html).toContain('data-phase="budget-reached"');
    expect(html).toContain("Paused — this month’s budget is spent");
    expect(html).toContain('href="/settings"');
    expect(html).toContain('data-in-flight="true"');
  });

  it("says plainly when nothing is draining the queue", () => {
    const html = render(item({ jobState: "queued", workerAbsent: true }));
    expect(html).toContain("the worker isn’t running");
  });

  it("a category is never shown as a bare label with no count behind it", () => {
    // A row reads "3 mistakes · mostly grammar", never a naked category word.
    const html = render(
      item({
        analysed: true,
        sessionYield: { findingsCount: 0, dominantCategory: null, segmentCount: 1, analysedSegmentCount: 1 },
      }),
    );
    for (const c of CATEGORIES) expect(html).not.toContain(`>${c}<`);
  });
});
