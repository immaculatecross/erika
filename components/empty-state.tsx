"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

interface EmptyStateProps {
  title: string;
  // One quiet sentence (DESIGN.md: empty states are a sentence and an action).
  line: string;
  action: string;
  // When wired, the action button performs it; otherwise it is a quiet stub.
  onAction?: () => void;
  disabled?: boolean;
  // An optional secondary control rendered beside the primary action (e.g. the
  // mic recorder next to Upload). Kept neutral so only one element is accented.
  secondary?: ReactNode;
}

// Sessions and Practice both render this: no illustration, one sentence, one
// action. Content staggers in and degrades to a fade under reduced motion.
export function EmptyState({ title, line, action, onAction, disabled, secondary }: EmptyStateProps) {
  const reduced = usePrefersReducedMotion();
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex max-w-md flex-col items-center gap-4 text-center"
      >
        <motion.h1 variants={staggerItem(reduced)} className="text-[34px] font-bold tracking-tight">
          {title}
        </motion.h1>
        <motion.p variants={staggerItem(reduced)} className="text-[17px] text-secondary">
          {line}
        </motion.p>
        <motion.div
          variants={staggerItem(reduced)}
          className="flex flex-wrap items-center justify-center gap-3"
        >
          {secondary}
          <button
            type="button"
            onClick={onAction}
            disabled={disabled}
            className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
          >
            {action}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
