"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Ear } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { ShadowDrill } from "@/lib/shadow";

// The listen-and-shadow drill list (E-33, D-18). Each row is a CORRECT target phrase
// — a finding's recast, never the error — to hear and shadow. DESIGN.md: calm rows,
// ink accent, one signature stagger. The target is shown headlined (correction-
// forward, D-18); the original error never appears here.

export default function ShadowListPage() {
  const reduced = usePrefersReducedMotion();
  const [drills, setDrills] = useState<ShadowDrill[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/shadow")
      .then((r) => r.json())
      .then((d: { drills: ShadowDrill[] }) => alive && setDrills(d.drills))
      .catch(() => alive && setDrills([]));
    return () => {
      alive = false;
    };
  }, []);

  const back = (
    <div className="mb-6">
      <Link
        href="/practice"
        className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Today
      </Link>
    </div>
  );

  if (drills === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Gathering phrases to shadow…</p>
      </div>
    );
  }

  if (drills.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        {back}
        <h1 className="text-[34px] font-bold tracking-tight">Shadow</h1>
        <p className="mt-4 text-[17px] text-secondary">
          No phrases to shadow yet. Record and analyze some speech, and your corrections become
          shadowing drills here.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      {back}
      <h1 className="mb-2 text-[34px] font-bold tracking-tight">Shadow</h1>
      <p className="mb-6 text-[17px] text-secondary">Hear a correct phrase, then say it back.</p>
      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-2"
      >
        {drills.map((d) => (
          <motion.li key={d.findingId} variants={staggerItem(reduced)}>
            <Link
              href={`/practice/learn/shadow/${encodeURIComponent(d.findingId)}`}
              data-shadow-drill
              className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
            >
              <span className="flex min-w-0 items-center gap-3">
                <Ear size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
                <span className="truncate text-[17px] text-ink" lang="it">
                  {d.target}
                </span>
              </span>
              <span className="shrink-0 text-[13px] uppercase tracking-[0.06em] text-secondary">
                {d.category}
              </span>
            </Link>
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}
