"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { CompareControl } from "@/components/compare-control";

// The practice card and its signature moment: the 3D flip (DESIGN.md — "the
// practice card's 3D flip"). Correction-forward (E-29, D-18): the front is a
// meaning-first cue toward the correct form (never your error); the back headlines
// the correction and its reason, and shows your original utterance exactly once,
// subordinate and marked as the error. A flip is transform-only (rotateY, spring)
// so it stays on the GPU at 60fps; under prefers-reduced-motion it degrades to a
// crossfade with no rotation. `data-motion` records which variant rendered so an
// e2e can prove reduced-motion took the crossfade path.

interface Props {
  /** The meaning-first stimulus (a context gap / category cue) — never the error. */
  front: string;
  /** The correct form — the retrieval target, headlined on the back. */
  correction: string;
  /** The reason the recast reads native, possibly empty. */
  why: string;
  /** The user's original utterance — shown once on the back, marked as the error. */
  error: string;
  category: string;
  flipped: boolean;
  /** The finding this card is built from — powers the back's Compare control (E-21). */
  findingId: string;
}

export function Flashcard({ front, correction, why, error, category, flipped, findingId }: Props) {
  const reduced = usePrefersReducedMotion();

  if (reduced) {
    // Reduced motion: swap faces with an opacity crossfade — never a rotation.
    return (
      <div
        data-flashcard
        data-motion="crossfade"
        data-flipped={flipped}
        className="relative h-80 w-full max-w-xl"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={flipped ? "back" : "front"}
            data-face={flipped ? "back" : "front"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0"
          >
            <Face>
              {flipped ? (
                <Back category={category} correction={correction} why={why} error={error} findingId={findingId} />
              ) : (
                <Front category={category} front={front} />
              )}
            </Face>
          </motion.div>
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div
      data-flashcard
      data-motion="flip"
      data-flipped={flipped}
      className="relative h-80 w-full max-w-xl [perspective:1200px]"
    >
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={SPRING}
      >
        <Face face="front" className="[backface-visibility:hidden] [transform:rotateY(0deg)]">
          <Front category={category} front={front} />
        </Face>
        <Face face="back" className="[backface-visibility:hidden] [transform:rotateY(180deg)]">
          <Back category={category} correction={correction} why={why} error={error} findingId={findingId} />
        </Face>
      </motion.div>
    </div>
  );
}

function Face({
  children,
  className = "",
  face,
}: {
  children: React.ReactNode;
  className?: string;
  face?: "front" | "back";
}) {
  return (
    <div
      data-face={face}
      className={`absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-card bg-card px-8 py-10 text-center shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

function CategoryLabel({ category }: { category: string }) {
  return (
    <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
      {category}
    </span>
  );
}

function Front({ category, front }: { category: string; front: string }) {
  return (
    <>
      <CategoryLabel category={category} />
      <p data-card-front className="text-[28px] font-semibold leading-tight tracking-tight text-ink">
        {front}
      </p>
      <span className="text-[13px] text-secondary">Say the correct form. Space or click to flip.</span>
    </>
  );
}

function Back({
  category,
  correction,
  why,
  error,
  findingId,
}: {
  category: string;
  correction: string;
  why: string;
  error: string;
  findingId: string;
}) {
  return (
    <>
      <CategoryLabel category={category} />
      <p className="text-[28px] font-semibold leading-tight tracking-tight text-ink">“{correction}”</p>
      {why && <p className="max-w-md text-[15px] leading-[1.47] text-secondary">{why}</p>}
      {/* The one confrontation (E-29, D-18): the user's error, shown once, marked —
          red is meaning here (D-14), strikethrough carries "don't say this". */}
      <p className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
          you said
        </span>
        <span
          data-card-error
          className="text-[15px] leading-[1.47] text-severe line-through decoration-severe/60"
        >
          “{error}”
        </span>
      </p>
      <CompareControl findingId={findingId} />
    </>
  );
}
