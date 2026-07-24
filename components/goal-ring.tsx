"use client";

import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The daily goal ring (E-31, DESIGN.md "The daily ritual" / D-24). ONE ring: accent
// ink drawn on a hairline track, closing on the standard spring — no second ring, no
// color fill, no confetti. The ring closing is the day's single celebratory beat.
// The centre carries the one number that matters (D-14), in tabular numerals.

const R = 42;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function GoalRing({
  done,
  total,
  size = 148,
}: {
  done: number;
  total: number;
  size?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  const offset = CIRCUMFERENCE * (1 - fraction);
  const complete = total > 0 && done >= total;

  return (
    <div
      data-goal-ring
      data-complete={complete ? "true" : "false"}
      className="relative"
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        {/* Hairline track — the full circle the ring closes onto. */}
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth={6} className="text-hairline" stroke="currentColor" />
        {/* Accent-ink progress ring, closing on the spring. */}
        <motion.circle
          cx="50"
          cy="50"
          r={R}
          fill="none"
          strokeWidth={6}
          strokeLinecap="round"
          className="text-ink"
          stroke="currentColor"
          strokeDasharray={CIRCUMFERENCE}
          initial={{ strokeDashoffset: CIRCUMFERENCE }}
          animate={{ strokeDashoffset: offset }}
          transition={reduced ? { duration: 0 } : SPRING}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span data-ring-done className="tabular text-[28px] font-bold leading-none text-ink">
          {done}
        </span>
        <span className="tabular mt-1 text-[13px] font-medium text-secondary">of {total}</span>
      </div>
    </div>
  );
}
