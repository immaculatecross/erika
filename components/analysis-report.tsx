"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Play } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatDuration } from "@/lib/format";
import type { AnalysisView, FindingView, Severity } from "@/lib/analysis-view";

// The findings report (E-4 part 2 criterion 3): a row of per-category counts
// across the five categories, then the findings themselves — each collapsed to
// its quote and severity, expanding in place (layout animation) to reveal the
// correction, the explanation, and a jump-to-audio control that seeks the reused
// player to the finding's start. Severity is the only colour and only as meaning
// (DESIGN.md D-8/D-14): red high, orange medium, green low; counts are tabular.

// Severity → its semantic tint. `low` reads as resolved/quiet green, `medium`
// orange, `high` red — 12% alpha fills, never saturated blocks (DESIGN.md).
const SEVERITY: Record<Severity, { label: string; dot: string; text: string; tint: string }> = {
  high: { label: "High", dot: "bg-severe", text: "text-severe", tint: "bg-severe/[0.12]" },
  medium: { label: "Medium", dot: "bg-medium", text: "text-medium", tint: "bg-medium/[0.12]" },
  low: { label: "Low", dot: "bg-good", text: "text-good", tint: "bg-good/[0.12]" },
};

interface Props {
  view: AnalysisView;
  /** Seek the reused audio player to a finding's start (ms). */
  onJump: (startMs: number) => void;
}

export function AnalysisReport({ view, onJump }: Props) {
  return (
    <div className="flex flex-col gap-5" data-analysis-report>
      <CountRow view={view} />
      <ul className="flex flex-col gap-2">
        {view.findings.map((f) => (
          <FindingRow key={f.id} finding={f} onJump={onJump} />
        ))}
      </ul>
    </div>
  );
}

function CountRow({ view }: { view: AnalysisView }) {
  return (
    <div>
      <p className="tabular text-[15px] text-secondary">
        {view.total} {view.total === 1 ? "finding" : "findings"} in this session
      </p>
      <div className="mt-3 grid grid-cols-5 gap-2" role="list" aria-label="Findings by category">
        {view.counts.map(({ category, count }) => (
          <div
            key={category}
            role="listitem"
            data-category-count={category}
            className="flex flex-col items-center gap-1 rounded-control bg-page py-3"
          >
            <span
              className={`tabular text-[22px] font-semibold tracking-tight ${
                count > 0 ? "text-ink" : "text-secondary"
              }`}
            >
              {count}
            </span>
            <span className="text-center text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
              {category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingRow({ finding, onJump }: { finding: FindingView; onJump: (startMs: number) => void }) {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[finding.severity];

  return (
    <motion.li
      layout={reduced ? false : "position"}
      transition={SPRING}
      data-finding
      data-finding-id={finding.id}
      data-expanded={open}
      className="overflow-hidden rounded-control bg-page"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[17px] text-ink">“{finding.quote}”</span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${sev.tint} ${sev.text}`}
        >
          {sev.label}
        </span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={reduced ? { duration: 0 } : SPRING}
          className="shrink-0 text-secondary"
        >
          <ChevronDown size={20} strokeWidth={1.5} />
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            data-finding-detail
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0.15 } : SPRING}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 px-4 pb-4">
              <Line label="You said" value={`“${finding.quote}”`} />
              <Line label="Erika's recast" value={`“${finding.correction}”`} accent />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
                  Why
                </span>
                <p className="text-[15px] leading-[1.47] text-ink">{finding.explanation}</p>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => onJump(finding.startMs)}
                  data-jump
                  data-start-ms={finding.startMs}
                  className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
                >
                  <Play size={16} strokeWidth={1.5} aria-hidden />
                  Play in context
                </button>
                <span className="tabular text-[13px] text-secondary">
                  {formatDuration(finding.startMs / 1000)}
                </span>
                <span className="text-[13px] text-secondary">· {finding.category}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function Line({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
        {label}
      </span>
      <p className={`text-[15px] leading-[1.47] ${accent ? "text-ink" : "text-secondary"}`}>{value}</p>
    </div>
  );
}
