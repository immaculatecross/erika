"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Reads the OS reduced-motion preference reactively. Framer Motion's own
 * useReducedMotion defaults to "never" and ignores the media query unless a
 * MotionConfig opts in, so we read matchMedia directly — the variant selectors
 * in lib/motion.ts then branch on the result. Server render is false; the
 * effect resolves the real value on the client.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setReduced(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);
  return reduced;
}
