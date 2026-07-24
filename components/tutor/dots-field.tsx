"use client";

import { motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The tutor surface (E-34, D-24): a quiet field of small accent-colored dots
// breathing with the tutor's voice — NO avatar, NO face, NO waveform theatrics. One
// calm surface. The dots gently pulse when the conversation is live and settle to a
// still, faint field when it is not; under prefers-reduced-motion they hold a static
// opacity instead of animating (DESIGN: transform/opacity only, springs, reduced
// motion degrades to no motion). Numbers elsewhere on the surface are tabular.

const DOT_COUNT = 28;

/** A deterministic per-dot phase offset so the field breathes as a loose whole, not
 *  in lockstep — no randomness (stable across renders). */
function phase(i: number): number {
  return (i % 7) * 0.18 + Math.floor(i / 7) * 0.09;
}

export function DotsField({ active, intensity = 0.5 }: { active: boolean; intensity?: number }) {
  const reduced = usePrefersReducedMotion();
  const amp = Math.max(0, Math.min(1, intensity));

  return (
    <div
      data-tutor-dots
      data-active={active}
      aria-hidden
      className="mx-auto grid w-full max-w-xs grid-cols-7 place-items-center gap-4 py-8"
    >
      {Array.from({ length: DOT_COUNT }, (_, i) => {
        const baseOpacity = active ? 0.35 + amp * 0.4 : 0.18;
        if (reduced || !active) {
          return (
            <span
              key={i}
              className="h-2.5 w-2.5 rounded-full bg-accent"
              style={{ opacity: baseOpacity }}
            />
          );
        }
        return (
          <motion.span
            key={i}
            className="h-2.5 w-2.5 rounded-full bg-accent"
            animate={{
              opacity: [baseOpacity, Math.min(1, baseOpacity + 0.3), baseOpacity],
              scale: [1, 1 + amp * 0.35, 1],
            }}
            transition={{
              duration: 1.8 + (i % 5) * 0.12,
              repeat: Infinity,
              ease: "easeInOut",
              delay: phase(i),
            }}
          />
        );
      })}
    </div>
  );
}
