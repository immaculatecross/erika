import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalysisPanel } from "@/components/analysis-panel";
import { analysisUnavailableMessage } from "@/lib/analysis-key";
import type { AnalysisView } from "@/lib/analysis-view";

// ONE CONFIRMATION, THEN NOTHING (E-42 criteria 1, 2, 7, 10) — at the render level.
//
// Criterion 1 asks for the count to be taken from the RENDERED DOM, not read off the
// source, because "no Analyze button" is defeated by a rename and "one confirmation"
// is a claim about what a person actually sees. `tests/session-row-render.test.tsx`
// counts the sessions row; this file counts the two surfaces on the capture path that
// used to carry the other four controls — the analysis panel's Analyze → estimate →
// Start → Cancel chain.
//
// The mic recorder's own keep/discard confirmation is exercised on the built server
// in the milestone walkthrough (it needs MediaRecorder, which no test environment
// here provides); what IS pinned here is that nothing downstream of it asks again.

const view = (over: Partial<AnalysisView> = {}): AnalysisView => ({
  state: "idle",
  stage: null,
  progress: 0,
  error: null,
  findings: [],
  counts: [],
  total: 0,
  segmentCount: 3,
  analysedCount: 0,
  unreadableCount: 0,
  workerAbsent: false,
  ...over,
});

function render(v: AnalysisView): string {
  const analysis = { view: v, polling: false, pollCount: 0, refresh: () => {} };
  return renderToStaticMarkup(<AnalysisPanel sessionId="s1" analysis={analysis} onJump={() => {}} />);
}

/** Every element a person could press inside the rendered markup. */
const buttons = (html: string) => html.match(/<button\b/g) ?? [];

describe("the analysis panel asks for nothing on the happy path (criteria 1–2)", () => {
  it("an ingested, unanalysed session offers NO control at all", () => {
    // The exact state that used to render Analyze. Four controls lived on this path
    // between "I stopped talking" and "analysis is running"; this is where two of
    // them were.
    const html = render(view({ state: "idle" }));
    expect(buttons(html)).toHaveLength(0);
    expect(html).not.toMatch(/Analyze/i);
    expect(html).not.toContain("data-analyze");
    expect(html).not.toContain("data-confirm-analyze");
    expect(html).not.toContain("data-analysis-confirm");
    // It says what is about to happen instead.
    expect(html).toContain("Nothing to press");
  });

  it("shows no control while a run is in flight, and none when it is done", () => {
    for (const v of [
      view({ state: "queued" }),
      view({ state: "processing", progress: 0.4 }),
      view({ state: "done", total: 0, analysedCount: 3 }),
    ]) {
      expect(buttons(render(v))).toHaveLength(0);
    }
  });

  it("carries no money anywhere — the estimate and the remaining-budget figures are gone", () => {
    // Criterion 7. `data-figure="estimate-total"` and `data-figure="remaining"` were
    // the two largest numbers on this screen.
    for (const v of [
      view({ state: "idle" }),
      view({ state: "processing", progress: 0.4 }),
      view({ state: "done", analysedCount: 3 }),
      view({ state: "halted", error: "Monthly budget reached.", analysedCount: 1 }),
    ]) {
      const html = render(v);
      expect(html).not.toMatch(/\$/);
      expect(html).not.toContain("data-figure");
      expect(html).not.toMatch(/estimated cost|remaining this month/i);
    }
  });
});

describe("the report survives, demoted — with a repair, not a step (criterion 10)", () => {
  it("a FAILED run offers exactly one control: try again", () => {
    const html = render(view({ state: "failed", error: "gpt-audio call failed: 500" }));
    expect(buttons(html)).toHaveLength(1);
    expect(html).toContain("data-retry-analysis");
    expect(html).toContain("gpt-audio call failed: 500");
  });

  it("a run stopped for want of a key offers a WAY OUT, never a retry into the same wall", () => {
    // Criterion 9: retrying changes nothing until a key exists, so offering the
    // button would be the loop RETRO-004 named. A link to where the requirement is
    // explained is the honest affordance.
    const html = render(view({ state: "failed", error: analysisUnavailableMessage() }));
    expect(buttons(html)).toHaveLength(0);
    expect(html).not.toContain("data-retry-analysis");
    expect(html).toContain('href="/settings"');
    expect(html).not.toMatch(/right now|temporarily/i);
    // And it does not shout "Analysis failed" at a learner who simply has not
    // configured anything yet.
    expect(html).not.toMatch(/Analysis failed/);
  });

  it("a run HELD by the cap offers no button either — it resumes by itself", () => {
    // Criterion 8. A control here would imply the learner has to rescue it.
    const html = render(view({ state: "halted", error: "Monthly budget reached.", analysedCount: 1 }));
    expect(buttons(html)).toHaveLength(0);
    expect(html).toContain('href="/settings"');
    expect(html).toMatch(/resumes on its own/i);
  });

  it("still states the truthful analysed count on a partial run", () => {
    const html = render(view({ state: "halted", segmentCount: 6, analysedCount: 1, unreadableCount: 1 }));
    expect(html).toContain("1 of 6 segments analysed");
  });
});
