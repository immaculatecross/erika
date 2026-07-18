"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { masteryPercent, type PatternSummary } from "@/lib/lessons/lessons-view";

// The lessons list under Practice (E-6b, WO criterion 1): the user's recurring
// error patterns (a category with >= 3 findings) from GET /api/lessons/patterns,
// each with its finding count and current mastery, linking into the runner. A
// quiet empty state until a pattern qualifies. DESIGN — calm rows, ink accent,
// green only on the mastery meter (a state that carries meaning, D-14), tabular
// numerals, one signature stagger on entry.

type Phase = "loading" | "ready";

export default function LessonsPage() {
  const reduced = usePrefersReducedMotion();
  const [patterns, setPatterns] = useState<PatternSummary[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await fetch("/api/lessons/patterns");
      const body = (await res.json()) as { patterns: PatternSummary[] };
      if (alive) {
        setPatterns(body.patterns);
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
        <p className="text-[15px] text-secondary">Finding your patterns…</p>
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div data-lessons-empty className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-[34px] font-bold tracking-tight">Lessons</h1>
          <p className="text-[17px] text-secondary">
            No recurring patterns yet. A lesson appears once Erika has found the same kind of slip at
            least three times.
          </p>
          <Link
            href="/practice"
            className="inline-block rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Back to practice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6">
        <Link
          href="/practice"
          className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
        >
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Practice
        </Link>
      </div>

      <h1 className="mb-2 text-[34px] font-bold tracking-tight">Lessons</h1>
      <p className="mb-6 text-[17px] text-secondary">
        Work on the mistakes you make most. Each lesson is built from your own recurring slips.
      </p>

      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-lessons-list
        className="flex flex-col gap-3"
      >
        {patterns.map((p) => (
          <motion.li key={p.key} variants={staggerItem(reduced)}>
            <Link
              href={`/practice/lessons/${encodeURIComponent(p.key)}`}
              data-pattern
              data-key={p.key}
              className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
            >
              <div className="flex flex-col gap-1">
                <span className="text-[17px] font-semibold capitalize text-ink">{p.category}</span>
                <span data-count className="tabular text-[15px] text-secondary">
                  {p.count} {p.count === 1 ? "finding" : "findings"}
                </span>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
                  Mastery
                </span>
                <div className="flex items-center gap-2.5">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-hairline">
                    <div
                      className="h-full rounded-full bg-good"
                      style={{ width: `${masteryPercent(p.mastery)}%` }}
                    />
                  </div>
                  <span data-mastery className="tabular text-[15px] font-semibold text-ink">
                    {masteryPercent(p.mastery)}%
                  </span>
                </div>
              </div>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
