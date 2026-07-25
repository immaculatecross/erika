"use client";

import Link from "next/link";
import { useState } from "react";
import { isMissingKeyMessage } from "@/lib/analysis-key";
import type { AnalysisPoll } from "@/lib/use-analysis";
import { segmentTally, type AnalysisView, type FindingView } from "@/lib/analysis-view";
import { AnalysisProgress } from "@/components/analysis-progress";
import { AnalysisReport } from "@/components/analysis-report";
import { WorkerAbsentNotice } from "@/components/worker-absent-notice";

// The analysis section of the session detail page.
//
// [E-42 criteria 2, 7, 10] THE REPORT SURVIVES, DEMOTED. What this panel used to own
// — press Analyze, fetch an estimate, read "$0.02 · remaining $9.98", press Start —
// is gone, along with `data-analyze`, `data-confirm-analyze`, `data-analysis-confirm`
// and the two money figures. Analysis is enqueued server-side when ingest completes
// (lib/analysis/auto.ts), so by the time anyone opens this page the run has already
// started or finished. The panel's job is now purely to SHOW: the orb while a run is
// live, the findings when it is done, and the truthful thing in every other case.
//
// The one control left is a REPAIR, not a step: a run that FAILED can be tried again
// from here (criterion 10). It is deliberately absent for the two states where
// pressing it would be a lie — a run held by the monthly cap resumes by itself when
// there is headroom (criterion 8), and a run with no API key would fail identically
// until a key exists, which is the retry loop RETRO-004 named.

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
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analysis`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not start the analysis again.");
      }
      refresh(); // the hook picks up the freshly-queued run and drives the orb
    } catch (err) {
      setRetryError((err as Error).message);
    } finally {
      setRetrying(false);
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

      {view && view.state === "idle" && <NotStartedYet segmentCount={view.segmentCount} />}

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
        <Stopped message={view.error} onRetry={retry} retrying={retrying} retryError={retryError} />
      )}

      {view && view.state === "halted" && (
        <div className="flex flex-col gap-4">
          <p className="text-[15px] text-medium" role="status">
            Paused — this month&rsquo;s budget is spent. What Erika heard so far is below, and the
            rest resumes on its own once there is room, or when the month rolls over.{" "}
            <Link href="/settings" className="text-ink underline underline-offset-2">
              Raise the budget
            </Link>
            .
          </p>
          {view.total > 0 && (
            <AnalysisReport
              view={view}
              onJump={onJump}
              highlightedFindingIds={highlightedFindingIds}
              selectedFindingId={selectedFindingId}
              onSelect={onSelectFinding}
            />
          )}
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
          {view.total > 0 && (
            <AnalysisReport
              view={view}
              onJump={onJump}
              highlightedFindingIds={highlightedFindingIds}
              selectedFindingId={selectedFindingId}
              onSelect={onSelectFinding}
            />
          )}
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
 * No run exists yet. With analysis automatic this is a brief, ordinary state — the
 * worker queues the run within a tick of ingest finishing — so the copy says what is
 * about to happen rather than offering a control. A session whose speech has not been
 * extracted at all says the narrower, truer thing: there is nothing to listen to yet.
 */
function NotStartedYet({ segmentCount }: { segmentCount: number }) {
  return (
    <p className="text-[15px] text-secondary" data-analysis-idle>
      {segmentCount === 0
        ? "Nothing to analyze yet — this session’s speech hasn’t been extracted."
        : "Erika will listen to this recording next. Nothing to press."}
    </p>
  );
}

/**
 * A stopped run: its own message, and a way forward.
 *
 * ONE authority decides which way forward, and it is this predicate. The call site
 * used to pass `onRetry={isMissingKeyMessage(...) ? null : retry}` as well — a second
 * copy of the same rule, and a DEAD one, since this component already branches on
 * `needsKey` before it looks at `onRetry`. A mutation test proved it dead: removing
 * the call-site guard changed nothing and every test stayed green, which is exactly
 * the shape RETRO-004 found in `isAssumedRunLeaseHash` (exported, documented as the
 * authority, and deletable green). So the duplicate is gone and this is the rule.
 *
 * The rule: a retry is offered only where trying again could differ. A missing key is
 * not such a case — it would fail identically until a key exists, which is the retry
 * loop RETRO-004 named — so that branch gets a link to where the requirement is
 * explained instead. (The worker re-runs the job by itself once a key appears; see
 * `resumeKeylessRefusals`.)
 */
function Stopped({
  message,
  onRetry,
  retrying,
  retryError,
}: {
  message: string | null;
  onRetry: () => void;
  retrying: boolean;
  retryError: string | null;
}) {
  const needsKey = isMissingKeyMessage(message);
  return (
    <div className="flex flex-col gap-3" data-analysis-stopped>
      <p className={`text-[15px] ${needsKey ? "text-medium" : "text-severe"}`} role={needsKey ? "status" : "alert"}>
        {needsKey ? "" : "Analysis failed — "}
        {message ?? "no error recorded."}
      </p>
      {needsKey ? (
        <Link
          href="/settings"
          className="self-start rounded-full bg-black/[0.06] px-4 py-2 text-[15px] font-medium text-ink transition-transform active:scale-[0.98] dark:bg-white/[0.08]"
        >
          What Erika needs
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={retrying}
          data-retry-analysis
          className="self-start rounded-full bg-black/[0.06] px-4 py-2 text-[15px] font-medium text-ink transition-transform active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08]"
        >
          {retrying ? "Starting…" : "Try again"}
        </button>
      )}
      {retryError && (
        <p className="text-[13px] text-severe" role="alert">
          {retryError}
        </p>
      )}
    </div>
  );
}
