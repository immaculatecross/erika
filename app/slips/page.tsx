"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { SlipStateBadge } from "@/components/slip-state-badge";
import type { SlipsIndex, SlipSummary } from "@/lib/slips";

// The slips index (E-20): every recurring mistake as one persistent slip, active
// ones first (the work), resolved ones last (mastery). Reached from Focus — NOT a
// top-level nav item (DESIGN binding). DESIGN — calm rows, one accent number
// (occurrences), green reserved for resolved/remission (D-14), one stagger in.
export default function SlipsPage() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState<SlipsIndex | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/slips")
      .then((r) => r.json())
      .then((m: SlipsIndex) => alive && setIndex(m))
      .catch(() => alive && setIndex({ slips: [], resolvedCount: 0, remissionCount: 0, activeCount: 0 }));
    return () => {
      alive = false;
    };
  }, []);

  if (index === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Reading your slips…</p>
      </div>
    );
  }

  if (index.slips.length === 0) {
    return (
      <EmptyState
        title="Slips"
        line="Your recurring mistakes gather here once Erika has analyzed a session — one slip per habit, tracked until you stop making it. Nothing yet."
        action="Go to focus"
        href="/focus"
      />
    );
  }

  return (
    <div data-slips className="mx-auto max-w-3xl p-8">
      <Link
        href="/focus"
        className="mb-6 inline-flex items-center gap-1.5 text-[15px] text-secondary hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Focus
      </Link>

      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Slips</h1>
        <p className="mt-1 tabular text-[13px] text-secondary">
          {index.slips.length} {index.slips.length === 1 ? "slip" : "slips"} · {index.activeCount} active ·{" "}
          {index.remissionCount} in remission · {index.resolvedCount} resolved
        </p>
      </header>

      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-slip-list
        className="flex flex-col gap-3"
      >
        {index.slips.map((slip) => (
          <Row key={slip.id} slip={slip} reduced={reduced} />
        ))}
      </motion.ul>
    </div>
  );
}

function Row({ slip, reduced }: { slip: SlipSummary; reduced: boolean }) {
  return (
    <motion.li
      variants={staggerItem(reduced)}
      data-slip
      data-slip-id={slip.id}
      data-slip-state={slip.standing.state}
    >
      <Link
        href={`/slips/${slip.id}`}
        className="flex items-center gap-4 rounded-card bg-card p-5 shadow-card transition-transform hover:bg-hairline active:scale-[0.99]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
              {slip.category}
            </span>
            <SlipStateBadge state={slip.standing.state} />
          </div>
          <p className="mt-1.5 truncate text-[17px] font-semibold text-ink">“{slip.correction}”</p>
          <p className="mt-1 tabular text-[13px] text-secondary">{slip.statusLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="tabular text-right text-[13px] text-secondary">
            {slip.occurrences} {slip.occurrences === 1 ? "time" : "times"}
          </span>
          <ArrowRight size={16} strokeWidth={1.5} aria-hidden className="text-secondary" />
        </div>
      </Link>
    </motion.li>
  );
}
