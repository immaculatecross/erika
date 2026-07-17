"use client";

import { motion } from "framer-motion";
import { pageVariants } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// A template re-mounts on every navigation, so it animates each route in with
// the crossfade + 12px rise. Under prefers-reduced-motion it fades only.
export default function Template({ children }: { children: React.ReactNode }) {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.div
      data-page-transition
      data-reduced-motion={reduced ? "true" : "false"}
      variants={pageVariants(reduced)}
      initial="initial"
      animate="animate"
      className="h-full"
    >
      {children}
    </motion.div>
  );
}
