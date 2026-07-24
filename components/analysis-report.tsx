"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Play } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatDuration } from "@/lib/format";
import { SEVERITY_STYLES, type AnalysisView, type FindingView } from "@/lib/analysis-view";

// The findings report (E-4 part 2 criterion 3): a row of per-category counts
// across the five categories, then the findings themselves. Correction-forward
// (E-29, D-18): each row leads with the CORRECTION and its severity, expanding in
// place (layout animation) to reveal the reason, the original quote shown exactly
// once — subordinate and marked as the error, the one confrontation — and a
// jump-to-audio control that seeks the reused player to the finding's start.
// Severity styling comes whole from the shared SEVERITY_STYLES (D-14, E-18
// criterion 6): red high, orange medium, low neutral — green is reserved for
// resolved/mastered/improving.

interface Props {
  view: AnalysisView;
  /** Seek the reused audio player to a finding's start (ms). */
  onJump: (startMs: number) => void;
  /** Findings to highlight — the session-map selection, shared with the timeline. */
  highlightedFindingIds?: ReadonlySet<string>;
  /** The single finding to scroll into view (a marker was clicked on the map). */
  selectedFindingId?: string | null;
  /** Select this finding (highlight its segment on the map). */
  onSelect?: (finding: FindingView) => void;
}

export function AnalysisReport({ view, onJump, highlightedFindingIds, selectedFindingId, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-5" data-analysis-report>
      <CountRow view={view} />
      <ul className="flex flex-col gap-2">
        {view.findings.map((f) => (
          <FindingRow
            key={f.id}
            finding={f}
            onJump={onJump}
            highlighted={highlightedFindingIds?.has(f.id) ?? false}
            scrollTo={selectedFindingId === f.id}
            onSelect={onSelect}
          />
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

export function FindingRow({
  finding,
  onJump,
  highlighted = false,
  scrollTo = false,
  onSelect,
  defaultOpen = false,
}: {
  finding: FindingView;
  onJump: (startMs: number) => void;
  highlighted?: boolean;
  scrollTo?: boolean;
  onSelect?: (finding: FindingView) => void;
  /** Seed the expanded state — used by render tests; the app starts collapsed. */
  defaultOpen?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState(defaultOpen);
  const sev = SEVERITY_STYLES[finding.severity];
  const ref = useRef<HTMLLIElement>(null);

  // A marker clicked on the map scrolls its finding into view here.
  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
  }, [scrollTo, reduced]);

  return (
    <motion.li
      ref={ref}
      layout={reduced ? false : "position"}
      transition={SPRING}
      data-finding
      data-finding-id={finding.id}
      data-expanded={open}
      data-selected={highlighted}
      className={`overflow-hidden rounded-control bg-page transition-shadow ${
        highlighted ? "ring-2 ring-accent" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          onSelect?.(finding); // highlight this finding's segment on the map
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-transform active:scale-[0.99]"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
        <span data-finding-correction className="min-w-0 flex-1 truncate text-[17px] text-ink">
          “{finding.correction}”
        </span>
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
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
                  Why
                </span>
                <p className="text-[15px] leading-[1.47] text-ink">{finding.explanation}</p>
              </div>
              {/* The one confrontation (E-29, D-18): the original quote, shown once,
                  subordinate to the correction above and marked as the error. */}
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
                  You said
                </span>
                <p
                  data-finding-error
                  className="text-[15px] leading-[1.47] text-severe line-through decoration-severe/60"
                >
                  “{finding.quote}”
                </p>
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
