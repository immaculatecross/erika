"use client";

import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { ANALYSIS_STAGE_LABELS } from "@/lib/analysis-view";

// The analysis progress orb — this surface's ONE signature moment (DESIGN.md).
// A filled disc grows with real run progress (spring on `scale`, transform-only)
// while it breathes on `opacity` to read as alive; the stage label and percent
// sit alongside in tabular numerals. Under prefers-reduced-motion the breathing
// stops and the fill is static — the orb still reflects progress, it just no
// longer moves (DESIGN: everything degrades to opacity/none).

interface Props {
  /** The job stage (analyzing/done) — mapped to a quiet label. */
  stage: string | null;
  /** 0..1 run progress. */
  progress: number;
  /** True while queued (not yet processing): the orb idles small and breathing. */
  queued: boolean;
}

export function AnalysisProgress({ stage, progress, queued }: Props) {
  const reduced = usePrefersReducedMotion();
  const p = Math.min(1, Math.max(0, progress));
  const pct = Math.round(p * 100);
  // The disc spans 40%→100% of the well as the run advances, so there is always a
  // visible orb (queued reads as a small, waiting disc) that grows toward full.
  const scale = 0.4 + 0.6 * p;
  const label = queued ? "Queued" : (stage && ANALYSIS_STAGE_LABELS[stage]) || "Analyzing";

  return (
    <div className="flex items-center gap-4" data-analysis-progress data-progress-pct={pct}>
      <div className="relative h-16 w-16 shrink-0" aria-hidden>
        <div className="absolute inset-0 rounded-full bg-hairline" />
        <motion.div
          className="absolute inset-0 rounded-full bg-accent"
          initial={false}
          animate={{ scale, opacity: reduced ? 0.9 : [0.55, 0.85, 0.55] }}
          transition={{
            scale: SPRING,
            opacity: reduced
              ? { duration: 0 }
              : { duration: 1.6, repeat: Infinity, ease: "easeInOut" },
          }}
        />
      </div>
      <div className="flex flex-col gap-0.5" role="status" aria-live="polite">
        <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {label}
        </span>
        <span className="tabular text-[22px] font-semibold tracking-tight text-ink">{pct}%</span>
      </div>
    </div>
  );
}
