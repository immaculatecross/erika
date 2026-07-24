"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { PlacementCheckItem } from "@/lib/placement/check";
import type { PlacementAnswer } from "@/lib/placement/scoring";

// The rapid yes/no vocabulary check (E-35, D-24). One word at a time, two quiet
// choices — "I know it" / "I don't" — and a plain tabular counter. No score shown,
// no streak, no timer pressure: the instrument stays calm. Each word springs in with
// the standard motion; reduced-motion degrades to a fade. The parent collects the
// annotated answers (the item's band/itemId echoed back with the learner's choice)
// and posts them to be scored.

export function VocabCheck({
  items,
  onDone,
}: {
  items: PlacementCheckItem[];
  onDone: (answers: PlacementAnswer[]) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);

  const item = items[i];
  if (!item) return null;

  function answer(known: boolean) {
    const a: PlacementAnswer =
      item.kind === "real"
        ? { kind: "real", band: item.band, itemId: item.itemId, known }
        : { kind: "pseudo", known };
    const next = [...answers, a];
    if (i + 1 >= items.length) {
      onDone(next);
    } else {
      setAnswers(next);
      setI(i + 1);
    }
  }

  return (
    <div data-vocab-check className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-10 p-8">
      <p className="tabular text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
        {i + 1} / {items.length}
      </p>

      <div className="flex min-h-[3.5rem] items-center justify-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={item.id}
            data-word
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 260, damping: 28 }}
            className="text-[34px] font-bold tracking-tight text-ink"
          >
            {item.word}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="flex w-full gap-3">
        <button
          type="button"
          data-answer="no"
          onClick={() => answer(false)}
          className="flex-1 rounded-full bg-black/[0.06] px-5 py-3 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
        >
          I don&rsquo;t
        </button>
        <button
          type="button"
          data-answer="yes"
          onClick={() => answer(true)}
          className="flex-1 rounded-full bg-accent px-5 py-3 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          I know it
        </button>
      </div>

      <p className="max-w-xs text-center text-[13px] text-secondary">
        Mark the words you know. Some are not real words — say so when one looks invented.
      </p>
    </div>
  );
}
