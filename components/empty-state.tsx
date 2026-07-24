"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

const PRIMARY_ACTION_CLASS =
  "rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50";
const SECONDARY_ACTION_CLASS =
  "rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]";

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
  // [polish] Render the named action as the secondary (neutral) control when the
  // accented lead lives in `secondary` instead — the record-first home leads with Record.
  actionVariant?: "primary" | "secondary";
  // An optional control rendered beside the action (e.g. the mic recorder next to
  // Upload). Only one element is accented across the pair.
  secondary?: ReactNode;
}

// Every screen's quiet zero-state renders this: no illustration, one sentence,
// one action. Content staggers in and degrades to a fade under reduced motion.
export function EmptyState({ title, line, action, href, onAction, disabled, actionVariant = "primary", secondary }: EmptyStateProps) {
  const reduced = usePrefersReducedMotion();
  const actionClass = actionVariant === "primary" ? PRIMARY_ACTION_CLASS : SECONDARY_ACTION_CLASS;
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
            <Link href={href} className={`inline-block ${actionClass}`}>
              {action}
            </Link>
          ) : (
            <button type="button" onClick={onAction} disabled={disabled} className={actionClass}>
              {action}
            </button>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
