"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

const ACTION_CLASS =
  "rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50";

interface EmptyStateProps {
  title: string;
  // One quiet sentence (DESIGN.md: empty states are a sentence and an action).
  line: string;
  action: string;
  // The action either navigates (href) or performs (onAction) — always real
  // (RETRO-001: a disabled button that names an impossible view is no action).
  href?: string;
  onAction?: () => void;
  disabled?: boolean;
  // An optional secondary control rendered beside the primary action (e.g. the
  // mic recorder next to Upload). Kept neutral so only one element is accented.
  secondary?: ReactNode;
}

// Every screen's quiet zero-state renders this: no illustration, one sentence,
// one action. Content staggers in and degrades to a fade under reduced motion.
export function EmptyState({ title, line, action, href, onAction, disabled, secondary }: EmptyStateProps) {
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
          {href ? (
            <Link href={href} className={`inline-block ${ACTION_CLASS}`}>
              {action}
            </Link>
          ) : (
            <button type="button" onClick={onAction} disabled={disabled} className={ACTION_CLASS}>
              {action}
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
