import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WORKER_ABSENT_MESSAGE } from "@/lib/jobs/liveness";
import type { AnalysisView } from "@/lib/analysis-view";

// E-17 fold-in 4 (E-16 review, advisory 1): the render-level test criterion 2 of
// the previous milestone never had.
//
// `workerAbsent` was already computed truthfully and `tests/worker-liveness.test.ts`
// pins the verdict — but `NotIngestedYet` rendered `<WorkerAbsentNotice />` with no
// reference to it at all, so the path bypassed the verdict entirely. On every
// healthy upload the page showed a live ingest bar and, directly beneath it, "Not
// processing — start the worker": a signal that is always on is not a signal.
// A verdict-level test cannot catch that; only rendering can.
//
// Rendered with `renderToStaticMarkup`, which runs the component tree without a
// DOM: the effects that need `window` (usePrefersReducedMotion) do not run, and
// the polling hook is mocked, so this makes no fetch and needs no network.

const view = (over: Partial<AnalysisView> = {}): AnalysisView => ({
  state: "idle",
  stage: null,
  progress: 0,
  error: null,
  findings: [],
  counts: [],
  total: 0,
  segmentCount: 0,
  analysedCount: 0,
  unreadableCount: 0,
  workerAbsent: false,
  ...over,
});

const mockView = vi.hoisted(() => ({ current: null as AnalysisView | null }));
vi.mock("@/lib/use-analysis", () => ({
  useAnalysis: () => ({ view: mockView.current, polling: false, pollCount: 0, refresh: () => {} }),
}));

async function render(v: AnalysisView): Promise<string> {
  mockView.current = v;
  const { AnalysisPanel } = await import("@/components/analysis-panel");
  return renderToStaticMarkup(<AnalysisPanel sessionId="s1" onJump={() => {}} />);
}

/** The notice, by its data attribute — the same hook the e2e uses. */
const showsNotice = (html: string) => html.includes("data-worker-absent");

describe("AnalysisPanel — the worker-absent notice is a signal, not decoration", () => {
  it("does NOT render it on a freshly uploaded session still being ingested", async () => {
    // state idle + no segments yet = `NotIngestedYet`, the most common path in the
    // app: this is exactly where it used to fire on every healthy upload.
    const html = await render(view({ state: "idle", segmentCount: 0 }));
    expect(html).toContain('data-analysis-blocked="no-segments"'); // the panel did render
    expect(showsNotice(html)).toBe(false);
    expect(html).not.toContain("npm run worker");
  });

  it("does NOT render it on a job that is queued or processing normally", async () => {
    for (const state of ["queued", "processing"] as const) {
      const html = await render(view({ state, segmentCount: 3, workerAbsent: false }));
      expect(html).toContain("data-analysis-progress"); // the orb is up
      expect(showsNotice(html)).toBe(false);
    }
  });

  it("DOES render it when the job is demonstrably not moving", async () => {
    const html = await render(view({ state: "queued", segmentCount: 3, workerAbsent: true }));
    expect(showsNotice(html)).toBe(true);
    expect(html).toContain(WORKER_ABSENT_MESSAGE.split("`")[0].trim());
  });

  it("states the truthful analysed count on a halted run", async () => {
    const html = await render(
      view({ state: "halted", segmentCount: 6, analysedCount: 1, unreadableCount: 1, error: "budget" }),
    );
    expect(html).toContain("1 of 6 segments analysed");
    expect(html).not.toContain("5 of 6"); // the count the old derivation claimed
  });
});
