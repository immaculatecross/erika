"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { LearnToday } from "@/components/learn-today";
import type { TodayView } from "@/lib/today";

// The Learn home (E-44, D-26). The wire only: fetch today, render it, or say plainly
// that it could not be read and offer a control that actually retries. Every product
// decision lives in `components/learn-today.tsx`, which is pure and unit-tested.
//
// The old page substituted a fully-zeroed view when the fetch failed, so an outage
// rendered as "Nothing to practice right now." — a confident, false, dead-ended
// answer. A failure now says it failed and hands back a working retry.

type Phase = { kind: "loading" } | { kind: "ready"; view: TodayView } | { kind: "error" };

export default function LearnTodayPage() {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const load = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/learn/today");
      if (!res.ok) throw new Error(String(res.status));
      setPhase({ kind: "ready", view: (await res.json()) as TodayView });
    } catch {
      setPhase({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The daily composer has now selected the item. Preparation starts here, on the
  // Learn home, never when the lesson is opened. While this POST is genuinely in
  // flight the pure surface replaces Start with one calm status line. A second tab
  // sees the shared claim as "preparing" and polls the read model; it never makes a
  // second provider call.
  useEffect(() => {
    if (phase.kind !== "ready" || phase.view.action.kind !== "start") return;
    if (phase.view.lessonPreparation === "needed") {
      setPhase({
        kind: "ready",
        view: { ...phase.view, lessonPreparation: "preparing" },
      });
      fetch("/api/session/prepare", { method: "POST" })
        .then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return load();
        })
        .catch(() => setPhase({ kind: "error" }));
      return;
    }
    if (phase.view.lessonPreparation === "preparing") {
      const timer = window.setTimeout(() => void load(), 500);
      return () => window.clearTimeout(timer);
    }
  }, [phase, load]);

  if (phase.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Composing today&rsquo;s session…</p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
        <h1 className="text-[34px] font-bold tracking-tight">Today</h1>
        <p data-today-error className="text-[17px] leading-[1.47] text-secondary">
          Today&rsquo;s session could not be read just now.
        </p>
        <button
          type="button"
          data-today-retry
          onClick={() => void load()}
          className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.2 } : SPRING}
    >
      <LearnToday view={phase.view} />
    </motion.div>
  );
}
