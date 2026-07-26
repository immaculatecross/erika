"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, BookOpen, Sparkles } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatEstimate } from "@/lib/format";
import type { LearnItemSummary } from "@/lib/lessons/item-lessons-view";

// Today's composer-chosen grammar and vocabulary items to practise (E-32), over the
// Learn tab. Each row is an openable micro-lesson from the user's own knowledge edge,
// with an honest price — "Ready" once generated (a free re-open), else the estimated
// generation cost. DESIGN — calm rows, ink accent, tabular numerals, one signature
// stagger; no color but the meter-green elsewhere (D-14).

type Phase = "loading" | "ready";

function KindIcon({ kind }: { kind: LearnItemSummary["kind"] }) {
  return kind === "grammar" ? (
    <BookOpen size={20} strokeWidth={1.5} className="text-secondary" aria-hidden />
  ) : (
    <Sparkles size={20} strokeWidth={1.5} className="text-secondary" aria-hidden />
  );
}

export default function LearnItemsPage() {
  const reduced = usePrefersReducedMotion();
  const [items, setItems] = useState<LearnItemSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/learn/items");
      const body = (await res.json()) as { items: LearnItemSummary[] };
      if (alive) {
        setItems(body.items);
        setPhase("ready");
      }
    })().catch(() => {
      if (alive) setPhase("ready");
    });
    return () => {
      alive = false;
    };
  }, []);

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Composing today&apos;s items…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div data-learn-items-empty className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-[34px] font-bold tracking-tight">Today&apos;s items</h1>
          <p className="text-[17px] text-secondary">
            No new grammar or vocabulary queued for today. Record more speech, or come back
            tomorrow for the next items at your knowledge edge.
          </p>
          <Link href="/practice" className="text-[15px] text-secondary transition-colors hover:text-ink">
            Back to Today
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link
          href="/practice"
          className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Today
        </Link>
      </div>
      <h1 className="mb-6 text-[34px] font-bold tracking-tight">Today&apos;s items</h1>
      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-2"
      >
        {items.map((it) => (
          <motion.li key={it.itemId} variants={staggerItem(reduced)}>
            <Link
              href={`/practice/learn/lesson/${encodeURIComponent(it.itemId)}`}
              data-learn-item
              data-kind={it.kind}
              className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
            >
              <span className="flex items-center gap-3">
                <KindIcon kind={it.kind} />
                <span className="flex flex-col">
                  <span className="text-[17px] font-medium text-ink">{it.label}</span>
                  <span className="text-[13px] uppercase tracking-[0.06em] text-secondary">{it.detail}</span>
                </span>
              </span>
              <span className="text-[15px] text-secondary">
                {it.hasLesson ? "Ready" : `Start — est. ${formatEstimate(it.estimateUsd ?? 0)}`}
              </span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
