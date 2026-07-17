import type { Transition, Variants } from "framer-motion";

// Motion vocabulary for the whole app (DESIGN.md "Motion — the soul"). Every
// variant is a pure function of `reduced` so the reduced-motion branch is unit
// testable: when reduced, nothing carries a transform — opacity only.

export const SPRING: Transition = { type: "spring", stiffness: 260, damping: 28 };

/** Route-change crossfade: 12px rise in, 12px lift out. Fades when reduced. */
export function pageVariants(reduced: boolean): Variants {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0.2 } },
      exit: { opacity: 0, transition: { duration: 0.15 } },
    };
  }
  return {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: SPRING },
    exit: { opacity: 0, y: -12, transition: { duration: 0.15 } },
  };
}

/** Parent that staggers its children in (30–45ms cadence). */
export function staggerContainer(reduced: boolean): Variants {
  return {
    initial: {},
    animate: {
      transition: { staggerChildren: reduced ? 0 : 0.04, delayChildren: reduced ? 0 : 0.02 },
    },
  };
}

/** List item: 8px rise + fade normally, opacity-only when reduced. */
export function staggerItem(reduced: boolean): Variants {
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0.2 } },
    };
  }
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: SPRING },
  };
}
