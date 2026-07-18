"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatUsd } from "@/lib/format";
import type { AnalysisPoll } from "@/lib/use-analysis";
import { segmentTally, type AnalysisView, type FindingView } from "@/lib/analysis-view";
import { AnalysisProgress } from "@/components/analysis-progress";
import { AnalysisReport } from "@/components/analysis-report";
import { WorkerAbsentNotice } from "@/components/worker-absent-notice";

// The analysis section of the session detail page (E-4 part 2). It owns the whole
// flow: pressing Analyze fetches the pre-run cost estimate and remaining budget
// and shows them before anything runs (criterion 1); confirming issues the POST
// and the polling hook then advances the progress orb without a reload
// (criterion 2); a done run renders the per-category findings report (criterion
// 3); halted/failed/empty runs each say their truthful thing (criterion 4). When
// the month's budget is already reached the estimate step shows that and never
// starts a run. The root carries data-* so an e2e can watch the live transition.

interface Estimate {
  estimate: { pendingCount: number; miniUsd: number; deepUsd: number; totalUsd: number };
  spentThisMonth: number;
  budgetUsd: number;
  remainingUsd: number;
}

type Phase =
  | { kind: "cta" }
  | { kind: "loading" }
  | { kind: "confirm"; est: Estimate }
  | { kind: "blocked"; est: Estimate }
  | { kind: "error"; message: string };

interface Props {
  sessionId: string;
  /** The analysis poll, lifted to the page so the session map shares its findings. */
  analysis: AnalysisPoll;
  /** Seek the reused audio player to a finding's start (ms). */
  onJump: (startMs: number) => void;
  /** Findings to highlight — the session-map selection, shared with the timeline. */
  highlightedFindingIds?: ReadonlySet<string>;
  /** The single finding to scroll into view (a marker was clicked on the map). */
  selectedFindingId?: string | null;
  /** Select a finding from the report (highlight its segment on the map). */
  onSelectFinding?: (finding: FindingView) => void;
}

export function AnalysisPanel({
  sessionId,
  analysis,
  onJump,
  highlightedFindingIds,
  selectedFindingId,
  onSelectFinding,
}: Props) {
  const { view, polling, pollCount, refresh } = analysis;
  const [phase, setPhase] = useState<Phase>({ kind: "cta" });
  const [starting, setStarting] = useState(false);

  async function openEstimate() {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analysis/estimate`);
      if (!res.ok) throw new Error("Could not read the cost estimate.");
      const est = (await res.json()) as Estimate;
      setPhase(est.remainingUsd <= 1e-9 ? { kind: "blocked", est } : { kind: "confirm", est });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  async function start() {
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analysis`, { method: "POST" });
      if (res.status === 402) {
        // The server re-checked the budget and refused — reflect that truthfully.
        const est = phase.kind === "confirm" ? phase.est : undefined;
        setPhase(est ? { kind: "blocked", est } : { kind: "error", message: "Monthly budget reached." });
        return;
      }
      if (!res.ok) throw new Error("Could not start the analysis.");
      setPhase({ kind: "cta" });
      refresh(); // the hook picks up the freshly-queued run and drives the orb
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    } finally {
      setStarting(false);
    }
  }

  const state = view?.state ?? "loading";
  return (
    <section
      aria-label="Analysis"
      data-analysis
      data-analysis-state={state}
      data-polling={polling}
      data-poll-count={pollCount}
    >
      <h2 className="mb-4 text-[22px] font-semibold tracking-tight">Analysis</h2>

      {view === null && <p className="text-[15px] text-secondary">Reading analysis…</p>}

      {view && view.state === "idle" && view.segmentCount === 0 && <NotIngestedYet />}

      {view && view.state === "idle" && view.segmentCount > 0 && (
        <IdleFlow
          phase={phase}
          starting={starting}
          onAnalyze={openEstimate}
          onConfirm={start}
          onCancel={() => setPhase({ kind: "cta" })}
        />
      )}

      {view && (view.state === "queued" || view.state === "processing") && (
        <div className="flex flex-col gap-2">
          <AnalysisProgress
            stage={view.stage}
            progress={view.progress}
            queued={view.state === "queued"}
          />
          {view.workerAbsent && <WorkerAbsentNotice />}
        </div>
      )}

      {view && view.state === "failed" && (
        <p className="text-[15px] text-severe" role="alert">
          Analysis failed — {view.error ?? "no error recorded."}
        </p>
      )}

      {view && view.state === "halted" && (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-medium" role="status">
            Analysis stopped — {view.error ?? "the monthly budget was reached."} The findings so far
            are below; raise the budget or wait for the month to roll over to finish.
          </p>
          {view.total > 0 && <AnalysisReport
              view={view}
              onJump={onJump}
              highlightedFindingIds={highlightedFindingIds}
              selectedFindingId={selectedFindingId}
              onSelect={onSelectFinding}
            />}
          <SegmentTally view={view} />
        </div>
      )}

      {view && view.state === "done" && (
        <div className="flex flex-col gap-3">
          {view.total === 0 && (
            <p className="text-[15px] text-secondary">
              No errors found in this session&rsquo;s speech.
            </p>
          )}
          {view.total > 0 && <AnalysisReport
              view={view}
              onJump={onJump}
              highlightedFindingIds={highlightedFindingIds}
              selectedFindingId={selectedFindingId}
              onSelect={onSelectFinding}
            />}
          <SegmentTally view={view} />
        </div>
      )}
    </section>
  );
}

/**
 * The honest qualifier on a finished run. "No errors found" over 14 of 15 segments
 * is a different claim from the same words over all 15, and before this the
 * difference was invisible (E-16b criterion 4).
 */
function SegmentTally({ view }: { view: AnalysisView }) {
  const line = segmentTally(view.segmentCount, view.analysedCount, view.unreadableCount);
  if (!line) return null;
  return (
    <p className="tabular text-[13px] text-secondary" data-segment-tally>
      {line}
    </p>
  );
}

/**
 * A session whose speech has not been extracted yet has nothing to analyze. It
 * used to offer Analyze anyway: the estimate came back $0, the run finished
 * instantly, and it reported "no findings" — which reads as a clean bill of
 * health on audio no model ever heard (E-16b criterion 5).
 *
 * It also used to render `WorkerAbsentNotice` unconditionally, which is why every
 * healthy upload showed a live ingest bar with "Not processing — start the worker"
 * directly beneath it: a permanently-on signal is no signal (E-16 review, advisory
 * 1). Whether a worker is absent is a fact about a *job*, and the job in question
 * here is the ingest one — `IngestStatus` above already states it, from its own
 * `view.workerAbsent`. This panel only speaks when its own analysis job is stuck.
 */
function NotIngestedYet() {
  return (
    <div className="flex flex-col gap-3" data-analysis-blocked="no-segments">
      <p className="text-[15px] text-secondary">
        Nothing to analyze yet — this session&rsquo;s speech hasn&rsquo;t been extracted.
      </p>
      <button
        type="button"
        disabled
        data-analyze
        className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink opacity-50"
      >
        Analyze
      </button>
    </div>
  );
}

function IdleFlow({
  phase,
  starting,
  onAnalyze,
  onConfirm,
  onCancel,
}: {
  phase: Phase;
  starting: boolean;
  onAnalyze: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const reduced = usePrefersReducedMotion();

  if (phase.kind === "blocked") {
    return (
      <div className="flex flex-col gap-2" data-budget-reached>
        <p className="text-[15px] text-medium" role="status">
          Monthly budget reached — {formatUsd(phase.est.spentThisMonth)} of{" "}
          {formatUsd(phase.est.budgetUsd)} spent this month. Analysis can run again once the budget
          is raised or the month rolls over.
        </p>
      </div>
    );
  }

  if (phase.kind === "confirm") {
    const { estimate, remainingUsd, budgetUsd } = phase.est;
    return (
      <motion.div
        className="flex flex-col gap-4"
        data-analysis-confirm
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0.15 } : SPRING}
      >
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
          <Figure label="Estimated cost" value={formatUsd(estimate.totalUsd)} strong dataKey="estimate-total" />
          <Figure label="Remaining this month" value={formatUsd(remainingUsd)} dataKey="remaining" />
        </div>
        <p className="tabular text-[13px] text-secondary">
          {estimate.pendingCount} {estimate.pendingCount === 1 ? "segment" : "segments"} to analyze ·
          budget {formatUsd(budgetUsd)}/month
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={starting}
            data-confirm-analyze
            className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {starting ? "Starting…" : "Start analysis"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={starting}
            className="rounded-full px-4 py-2.5 text-[15px] font-medium text-secondary transition-colors hover:text-ink disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-severe" role="alert">
          {phase.message}
        </p>
        <button
          type="button"
          onClick={onAnalyze}
          className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    );
  }

  // cta / loading
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[15px] text-secondary">
        Have Erika listen to this session&rsquo;s speech and explain each mistake. You&rsquo;ll see
        the estimated cost before anything runs.
      </p>
      <button
        type="button"
        onClick={onAnalyze}
        disabled={phase.kind === "loading"}
        data-analyze
        className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
      >
        {phase.kind === "loading" ? "Estimating…" : "Analyze"}
      </button>
    </div>
  );
}

function Figure({
  label,
  value,
  strong,
  dataKey,
}: {
  label: string;
  value: string;
  strong?: boolean;
  dataKey: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
        {label}
      </span>
      <span
        data-figure={dataKey}
        className={`tabular tracking-tight ${strong ? "text-[34px] font-bold text-ink" : "text-[22px] font-semibold text-secondary"}`}
      >
        {value}
      </span>
    </div>
  );
}
