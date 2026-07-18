"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { Sparkline } from "@/components/sparkline";
import { CategoryBars, TrendBadge } from "@/components/category-bars";
import type { FocusModel } from "@/lib/focus";

// The Focus screen (E-7, v0.2): how often do I make each kind of mistake, is it
// getting better, and what should I work on next — the whole answer on one
// screen. The hero is the error rate per speaking-hour (the one accent number);
// the sparkline is the chronological trend; the ranked list is what to work on
// next. With nothing analyzed yet it keeps a quiet DESIGN-compliant empty state.
export default function FocusPage() {
  const reduced = usePrefersReducedMotion();
  const [model, setModel] = useState<FocusModel | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/focus")
      .then((r) => r.json())
      .then((m: FocusModel) => alive && setModel(m))
      .catch(() => alive && setModel(null));
    return () => {
      alive = false;
    };
  }, []);

  if (model === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Reading your speech…</p>
      </div>
    );
  }

  if (model.analyzedSessions === 0) {
    return (
      <EmptyState
        title="Focus"
        line="Your patterns appear here once Erika has analyzed a session. Nothing analyzed yet."
        action="See your patterns"
        disabled
      />
    );
  }

  return (
    <div data-focus className="mx-auto max-w-3xl p-8">
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-8"
      >
        <motion.header variants={staggerItem(reduced)}>
          <h1 className="text-[34px] font-bold tracking-tight">Focus</h1>
        </motion.header>

        <motion.section
          variants={staggerItem(reduced)}
          className="flex flex-wrap items-end justify-between gap-6 rounded-card bg-card p-6 shadow-card"
        >
          <div>
            <p className="tabular text-[34px] font-bold leading-none tracking-tight text-ink" data-focus-rate>
              {model.overallRatePerHour.toFixed(1)}
            </p>
            <p className="mt-2 text-[15px] text-secondary">errors per speaking hour</p>
            <p className="mt-1 tabular text-[13px] text-secondary">
              {model.speechHours.toFixed(1)} h of analyzed speech · {model.totalFindings}{" "}
              {model.totalFindings === 1 ? "finding" : "findings"} · {model.analyzedSessions}{" "}
              {model.analyzedSessions === 1 ? "session" : "sessions"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Sparkline values={model.trend.map((t) => t.ratePerHour)} />
            <TrendBadge trend={model.overallTrend} />
          </div>
        </motion.section>

        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-4">
          <div>
            <h2 className="text-[22px] font-semibold tracking-tight">What to work on next</h2>
            <p className="mt-1 text-[13px] text-secondary">
              Ranked by severity-weighted rate — Σ(weight × count) ÷ speech-hours, weighting high 3,
              medium 2, low 1. A falling rate is improving.
            </p>
          </div>
          <CategoryBars ranking={model.ranking} />
        </motion.section>
      </motion.div>
    </div>
  );
}
