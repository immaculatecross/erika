import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobStateBadge } from "@/components/job-state-badge";
import { AnalysisReport } from "@/components/analysis-report";
import { SEVERITY_STYLES, categoryCounts, type AnalysisView } from "@/lib/analysis-view";

// E-18 criterion 6: green is reserved for resolved/mastered/improving (D-14).
// A LOW-severity mistake is still a mistake and "Ready" ingest is plumbing —
// neither may wear green. The design tokens for green/red are `good`/`severe`
// (tailwind.config.ts), so the class names are the observable surface here,
// rendered through the real components, not asserted on constants alone.

const lowFinding = {
  id: "f1",
  quote: "una problema",
  correction: "un problema",
  category: "grammar" as const,
  explanation: "why",
  severity: "low" as const,
  startMs: 0,
  endMs: 500,
};

const doneView: AnalysisView = {
  state: "done",
  stage: null,
  progress: 1,
  error: null,
  findings: [lowFinding],
  counts: categoryCounts([lowFinding]),
  total: 1,
  segmentCount: 1,
  analysedCount: 1,
  unreadableCount: 0,
  workerAbsent: false,
};

describe("green is reserved (criterion 6)", () => {
  it("the ingest READY badge is neutral; failed keeps red — a state with meaning", () => {
    const ready = renderToStaticMarkup(<JobStateBadge state="done" />);
    expect(ready).toContain("Ready");
    expect(ready).not.toContain("good"); // no bg-good / text-good
    expect(ready).toContain("text-secondary");

    const failed = renderToStaticMarkup(<JobStateBadge state="failed" />);
    expect(failed).toContain("severe");
  });

  it("a LOW-severity finding renders neutral in the report — a mistake is not a win", () => {
    const html = renderToStaticMarkup(<AnalysisReport view={doneView} onJump={() => {}} />);
    expect(html).toContain("Low");
    expect(html).not.toContain("good");
  });

  it("the shared severity styles keep red/orange only where severity means it", () => {
    for (const sev of ["high", "medium", "low"] as const) {
      const s = SEVERITY_STYLES[sev];
      const classes = `${s.dot} ${s.text} ${s.tint}`;
      expect(classes).not.toContain("good");
    }
    expect(SEVERITY_STYLES.high.text).toBe("text-severe");
    expect(SEVERITY_STYLES.medium.text).toBe("text-medium");
    expect(SEVERITY_STYLES.low.text).toBe("text-secondary");
  });
});
