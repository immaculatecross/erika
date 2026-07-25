"use client";

import Link from "next/link";
import { formatCreatedAt, formatDuration } from "@/lib/format";
import {
  isInFlight,
  phaseAction,
  progressLine,
  sessionPhase,
  type SessionListItem,
  type SessionPhase,
} from "@/lib/sessions-list-view";

// One sessions-list row.
//
// [E-42 criterion 2] THE ANALYZE BUTTON IS GONE, and with it the estimate
// round-trip that used to live in this file: `data-inline-analyze`, the
// `/analysis/estimate` fetch, the "est. $0.02" figure, the Start/Cancel pair. A
// recording analyses itself the moment its speech is extracted
// (lib/analysis/auto.ts), so a row has nothing to ask the learner for — it only has
// to say, truthfully and quietly, where the recording is up to.
//
// The whole state machine is pure and lives in lib/sessions-list-view.ts, so what
// this row can say is unit-testable without a DOM and cannot drift from what the
// server knows. This file only chooses how it looks.

/** A row is a finished card once it has findings; anything else is visibly unfinished. */
function surfaceFor(phase: SessionPhase): string {
  return phase === "analysed"
    ? "bg-card shadow-card"
    : "border border-dashed border-hairline bg-transparent";
}

/**
 * A live indicator for the one phase where progress is a REAL ratio: the analysis
 * run counts completed segments against total segments. Ingest gets no bar, because
 * its `progress` is a stage checkpoint rather than a measurement and drawing it
 * would state a precision the code does not have.
 */
function AnalysisBar({ progress }: { progress: number }) {
  const p = Math.min(1, Math.max(0, progress));
  return (
    <div className="mt-1.5 h-[3px] w-full max-w-[180px] overflow-hidden rounded-full bg-hairline">
      <div
        data-analysis-bar
        className="h-full origin-left rounded-full bg-accent transition-transform"
        style={{ transform: `scaleX(${p})` }}
      />
    </div>
  );
}

export function SessionRow({ item }: { item: SessionListItem }) {
  const phase = sessionPhase(item);
  const action = phaseAction(item);
  const line = progressLine(item);
  const stopped = phase === "needs-key" || phase === "analysis-failed" || phase === "ingest-failed";

  return (
    <div
      data-session-row
      data-session-id={item.id}
      data-phase={phase}
      data-in-flight={isInFlight(phase)}
      className={`flex items-center justify-between gap-4 rounded-card p-4 ${surfaceFor(phase)}`}
    >
      <Link
        href={`/sessions/${item.id}`}
        className="min-w-0 flex-1 transition-opacity active:opacity-70"
      >
        <span className="block truncate text-[17px] text-ink">{item.originalFilename}</span>
        <span data-session-meta className="tabular text-[13px] text-secondary">
          {/* When they SPOKE, not when the row was written (E-42 criterion 6). */}
          {formatCreatedAt(item.capturedAt)} · {formatDuration(item.durationSeconds)}
        </span>
        <span
          data-session-line
          className={`mt-1 block text-[13px] ${stopped ? "text-medium" : "text-secondary"}`}
        >
          {line}
        </span>
        {phase === "analysing" && <AnalysisBar progress={item.analysisProgress} />}
      </Link>
      {action && (
        <Link
          href={action.href}
          data-phase-action
          className="shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium text-ink underline-offset-2 transition-opacity hover:underline active:opacity-70"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
