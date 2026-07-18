"use client";

import Link from "next/link";
import { useState } from "react";
import { JobStateBadge } from "@/components/job-state-badge";
import { formatCreatedAt, formatDuration, formatUsd } from "@/lib/format";
import { analyzeGate, type SessionListItem } from "@/lib/sessions-list-view";

// One sessions-list row (E-18 criteria 2–3). An analyzed session states its
// yield — analysed speech time, findings count, dominant category. An
// unanalyzed one looks unanalyzed (dashed outline, no filled card) and carries
// the inline Analyze affordance with the same pre-run cost estimate the session
// page shows. Sessions the server would refuse (ingest pending/failed, no
// speech) get their truthful state and no false affordance — the gate here
// mirrors the POST route's own 409 exactly (lib/sessions-list-view.ts).

interface Estimate {
  estimate: { totalUsd: number };
  remainingUsd: number;
}

type Phase =
  | { kind: "idle" }
  | { kind: "estimating" }
  | { kind: "confirm"; est: Estimate }
  | { kind: "starting"; est: Estimate }
  | { kind: "blocked" }
  | { kind: "error"; message: string };

/** The yield line an analyzed row states — speech heard, findings, dominant category. */
function yieldLine(item: SessionListItem): string {
  const y = item.sessionYield;
  if (!y) return "";
  const speech = `${formatDuration(y.analysedSpeechMs / 1000)} speech analysed`;
  if (y.findingsCount === 0) return `${speech} · no findings`;
  const findings = `${y.findingsCount} ${y.findingsCount === 1 ? "finding" : "findings"}`;
  return y.dominantCategory ? `${speech} · ${findings} · mostly ${y.dominantCategory}` : `${speech} · ${findings}`;
}

/** The inline estimate → confirm → start flow, against the existing endpoints. */
function InlineAnalyze({ sessionId, onStarted }: { sessionId: string; onStarted: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  async function estimate() {
    setPhase({ kind: "estimating" });
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analysis/estimate`);
      if (!res.ok) throw new Error("Could not read the cost estimate.");
      const est = (await res.json()) as Estimate;
      setPhase(est.remainingUsd <= 1e-9 ? { kind: "blocked" } : { kind: "confirm", est });
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  async function start(est: Estimate) {
    setPhase({ kind: "starting", est });
    try {
      const res = await fetch(`/api/sessions/${sessionId}/analysis`, { method: "POST" });
      if (res.status === 402) {
        setPhase({ kind: "blocked" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not start the analysis.");
      }
      onStarted();
    } catch (err) {
      setPhase({ kind: "error", message: (err as Error).message });
    }
  }

  if (phase.kind === "blocked") {
    return (
      <p className="text-[13px] text-medium" role="status">
        Monthly budget reached.
      </p>
    );
  }
  if (phase.kind === "error") {
    return (
      <p className="text-[13px] text-severe" role="alert">
        {phase.message}
      </p>
    );
  }
  if (phase.kind === "confirm" || phase.kind === "starting") {
    const busy = phase.kind === "starting";
    return (
      <span className="flex items-center gap-2.5" data-inline-confirm>
        <span data-inline-estimate className="tabular text-[13px] text-secondary">
          est. {formatUsd(phase.est.estimate.totalUsd)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void start(phase.est)}
          data-inline-start
          className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setPhase({ kind: "idle" })}
          className="rounded-full px-2.5 py-1.5 text-[13px] font-medium text-secondary transition-colors hover:text-ink disabled:opacity-50"
        >
          Cancel
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void estimate()}
      disabled={phase.kind === "estimating"}
      data-inline-analyze
      className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-50"
    >
      {phase.kind === "estimating" ? "Estimating…" : "Analyze"}
    </button>
  );
}

/** What the row's trailing slot shows for each gate state. */
function Trailing({ item, onStarted }: { item: SessionListItem; onStarted: () => void }) {
  const gate = analyzeGate(item);
  switch (gate) {
    case "analyze":
      return <InlineAnalyze sessionId={item.id} onStarted={onStarted} />;
    case "running":
      return <span className="text-[13px] text-secondary">Analyzing…</span>;
    case "no-segments":
      return <span className="text-[13px] text-secondary">No speech found</span>;
    case "ingest-pending":
    case "ingest-failed":
      return <JobStateBadge state={item.jobState} />;
    case "analysed":
      return null;
  }
}

export function SessionRow({ item, onStarted }: { item: SessionListItem; onStarted: () => void }) {
  const gate = analyzeGate(item);
  // An analyzed session is a finished, filled card; anything else is visibly
  // unfinished — an outline, not a surface (criterion 3: unanalyzed looks it).
  const surface =
    gate === "analysed"
      ? "bg-card shadow-card"
      : "border border-dashed border-hairline bg-transparent";
  return (
    <div
      data-session-row
      data-session-id={item.id}
      data-gate={gate}
      className={`flex items-center justify-between gap-4 rounded-card p-4 ${surface}`}
    >
      <Link
        href={`/sessions/${item.id}`}
        className="min-w-0 flex-1 transition-opacity active:opacity-70"
      >
        <span className="block truncate text-[17px] text-ink">{item.originalFilename}</span>
        <span data-session-meta className="tabular text-[13px] text-secondary">
          {formatCreatedAt(item.createdAt)} · {formatDuration(item.durationSeconds)}
        </span>
        {gate === "analysed" ? (
          <span data-session-yield className="tabular mt-1 block text-[13px] text-secondary">
            {yieldLine(item)}
          </span>
        ) : (
          <span data-not-analysed className="mt-1 block text-[13px] text-secondary">
            Not analyzed yet
          </span>
        )}
      </Link>
      <Trailing item={item} onStarted={onStarted} />
    </div>
  );
}
