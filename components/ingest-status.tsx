"use client";

import { ingestFailureLine, STAGE_LABELS, type IngestView, type TimelineSegment } from "@/lib/ingest-view";
import type { FindingMarkerInput } from "@/lib/session-map";
import { SegmentTimeline } from "@/components/segment-timeline";
import { WorkerAbsentNotice } from "@/components/worker-absent-notice";

// The ingest section of the session detail page (E-3 part 2). One component,
// four truthful states: a restrained progress bar while the job is queued or
// processing (stage + percent, a transform-only fill — NOT the E-4 orb); the
// raw-vs-speech summary and speech timeline when done; a quiet "no speech" line
// when done with nothing kept; the stored error when failed. The root carries
// data-* attributes so an e2e can watch the live, no-reload transition.

interface Props {
  view: IngestView | null;
  polling: boolean;
  pollCount: number;
  selectedIdx: number | null;
  onSelect: (segment: TimelineSegment) => void;
  /** The findings plotted over the timeline as the session map (E-22). */
  findings?: FindingMarkerInput[];
  highlightedFindingIds?: ReadonlySet<string>;
  onSelectFinding?: (id: string) => void;
}

function stageLabel(view: IngestView): string {
  if (view.state === "queued") return "Queued";
  return (view.stage && STAGE_LABELS[view.stage]) || "Processing";
}

export function IngestStatus({
  view,
  polling,
  pollCount,
  selectedIdx,
  onSelect,
  findings,
  highlightedFindingIds,
  onSelectFinding,
}: Props) {
  return (
    <section
      aria-label="Ingest"
      data-ingest
      data-ingest-state={view?.state ?? "loading"}
      data-polling={polling}
      data-poll-count={pollCount}
    >
      {view === null && <p className="text-[15px] text-secondary">Reading ingest…</p>}

      {view && (view.state === "queued" || view.state === "processing") && (
        <div className="flex flex-col gap-2">
          <Progress label={stageLabel(view)} progress={view.progress} />
          {view.workerAbsent && <WorkerAbsentNotice />}
        </div>
      )}

      {/* [v0.7 close sweep] This was `Ingest failed — {view.error}` — raw ffprobe stderr
          as the one thing the learner was told, beside no way forward at all: the route
          was GET-only, so nothing in the app could re-drive the job, and the only escape
          was to delete the session. Now the sentence is human, the requeue is real, and
          the stored error is kept directly underneath as a diagnosis rather than as the
          summary. Replace what is SHOWN, never what is recorded. */}
      {view && view.state === "failed" && (
        <div className="flex flex-col gap-3" data-ingest-failed>
          <p className="text-[15px] leading-[1.47] text-secondary" role="alert">
            {ingestFailureLine()}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {onRequeue && (
              <button
                type="button"
                data-ingest-requeue
                onClick={onRequeue}
                disabled={requeueing}
                className="rounded-full bg-card px-4 py-2 text-[15px] font-medium text-ink shadow-card transition-transform active:scale-[0.98] disabled:opacity-50"
              >
                {requeueing ? "Queued" : "Process it again"}
              </button>
            )}
          </div>
          {view.error && (
            <p className="text-[13px] text-secondary" data-ingest-error>
              What was recorded: <span className="font-mono">{view.error}</span>
            </p>
          )}
        </div>
      )}

      {view && view.state === "done" && view.summary.segmentCount === 0 && (
        <p className="text-[15px] text-secondary">No speech detected in this recording.</p>
      )}

      {view && view.state === "done" && view.summary.segmentCount > 0 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-[22px] font-semibold tracking-tight">
              <span className="tabular text-secondary">{view.summary.rawLabel}</span>
              <span className="mx-2 text-secondary" aria-hidden>
                →
              </span>
              <span className="tabular text-ink">{view.summary.speechLabel} speech</span>
            </p>
            <p className="tabular text-[13px] text-secondary">
              {view.summary.speechPercent}% of the recording is speech
            </p>
          </div>
          <SegmentTimeline
            segments={view.segments}
            totalMs={view.summary.rawMs}
            selectedIdx={selectedIdx}
            onSelect={onSelect}
            findings={findings}
            highlightedFindingIds={highlightedFindingIds}
            onSelectFinding={onSelectFinding}
          />
        </div>
      )}
    </section>
  );
}

function Progress({ label, progress }: { label: string; progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div className="flex flex-col gap-2" data-progress>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {label}
        </span>
        <span className="tabular text-[15px] text-ink" data-progress-pct>
          {pct}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-hairline">
        <div
          className="h-full origin-left rounded-full bg-accent transition-transform"
          style={{ transform: `scaleX(${Math.min(1, Math.max(0, progress))})` }}
        />
      </div>
    </div>
  );
}
