"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";

// The Practice screen (E-5): on arrival it generates cards from any new findings
// (idempotently) and reads the due count. With cards due it shows the count — the
// one number that matters here — and a start affordance into the full-screen
// runner; with none due it keeps E-1's quiet empty state. The number is the
// accent; content staggers in and fades under reduced motion.
export default function PracticePage() {
  const reduced = usePrefersReducedMotion();
  const [due, setDue] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await fetch("/api/cards/generate", { method: "POST" });
      const res = await fetch("/api/cards?due=1");
      const body = (await res.json()) as { dueCount: number };
      if (alive) setDue(body.dueCount);
    })().catch(() => {
      if (alive) setDue(0);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (due === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Counting due cards…</p>
      </div>
    );
  }

  if (due === 0) {
    return (
      <EmptyState
        title="Practice"
        line="No cards to review. They arrive once Erika has heard you speak."
        action="Review cards"
        disabled
      />
    );
  }

  return (
    <div data-practice className="flex min-h-screen items-center justify-center p-8">
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex max-w-md flex-col items-center gap-4 text-center"
      >
        <motion.h1 variants={staggerItem(reduced)} className="text-[34px] font-bold tracking-tight">
          Practice
        </motion.h1>
        <motion.p variants={staggerItem(reduced)} className="text-[17px] text-secondary">
          <span data-due-count className="tabular font-semibold text-ink">
            {due}
          </span>{" "}
          {due === 1 ? "card" : "cards"} due for review.
        </motion.p>
        <motion.div variants={staggerItem(reduced)} className="flex flex-col items-center gap-3">
          <Link
            href="/practice/review"
            data-start-practice
            className="inline-block rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Start practice
          </Link>
          <Link
            href="/practice/cards"
            data-browse-cards
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Browse all cards
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
