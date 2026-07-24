"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// Tap-to-reveal for the user's own error (E-29, D-18): correction-forward surfaces
// lead with the correct form and keep the mistake behind one tap, so it is seen
// once, on demand — never rehearsed as the stimulus. When hidden the error text is
// genuinely absent from the DOM (not just visually masked); revealing it renders it
// once, marked (red is meaning here, D-14; strikethrough carries "don't say this").
//
// `defaultRevealed` seeds the initial state so the two states can be render-tested
// without a DOM; in the app it starts hidden and the tap toggles it.

interface Props {
  /** The user's original utterance to reveal on demand. */
  text: string;
  /** Seed the initial reveal state (tests render both; the app starts hidden). */
  defaultRevealed?: boolean;
  /** The quiet label on the reveal control. */
  label?: string;
}

export function RevealableError({ text, defaultRevealed = false, label = "you said" }: Props) {
  const reduced = usePrefersReducedMotion();
  const [revealed, setRevealed] = useState(defaultRevealed);

  return (
    <div data-revealable-error data-revealed={revealed} className="flex flex-col gap-1.5">
      <button
        type="button"
        data-reveal-error
        aria-expanded={revealed}
        onClick={() => setRevealed((v) => !v)}
        className="inline-flex items-center gap-1.5 self-start text-[11px] font-medium uppercase tracking-[0.06em] text-secondary transition-colors hover:text-ink"
      >
        {label}
        <span aria-hidden className="text-[13px] normal-case tracking-normal text-secondary">
          {revealed ? "hide" : "reveal"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {revealed && (
          <motion.p
            key="error"
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: "auto" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={reduced ? { duration: 0.15 } : SPRING}
            className="overflow-hidden"
          >
            <span
              data-error-text
              className="text-[17px] leading-[1.47] text-severe line-through decoration-severe/60"
            >
              “{text}”
            </span>
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
