"use client";

import { AnimatePresence, motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { splitBack } from "@/lib/cards-view";

// The practice card and its signature moment: the 3D flip (DESIGN.md — "the
// practice card's 3D flip"). Front is your phrase in context; back is Erika's
// recast and the reason. A flip is transform-only (rotateY, spring) so it stays on
// the GPU at 60fps; under prefers-reduced-motion it degrades to a crossfade with
// no rotation. `data-motion` records which variant rendered so an e2e can prove
// reduced-motion took the crossfade path.

interface Props {
  front: string;
  back: string;
  category: string;
  flipped: boolean;
}

export function Flashcard({ front, back, category, flipped }: Props) {
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
            <Face>{flipped ? <Back category={category} back={back} /> : <Front category={category} front={front} />}</Face>
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
        <Face className="[backface-visibility:hidden] [transform:rotateY(0deg)]">
          <Front category={category} front={front} />
        </Face>
        <Face className="[backface-visibility:hidden] [transform:rotateY(180deg)]">
          <Back category={category} back={back} />
        </Face>
      </motion.div>
    </div>
  );
}

function Face({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
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
      <p className="text-[28px] font-semibold leading-tight tracking-tight text-ink">“{front}”</p>
      <span className="text-[13px] text-secondary">Space or click to flip</span>
    </>
  );
}

function Back({ category, back }: { category: string; back: string }) {
  const { recast, why } = splitBack(back);
  return (
    <>
      <CategoryLabel category={category} />
      <p className="text-[28px] font-semibold leading-tight tracking-tight text-ink">“{recast}”</p>
      {why && <p className="max-w-md text-[15px] leading-[1.47] text-secondary">{why}</p>}
    </>
  );
}
