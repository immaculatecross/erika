"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, AudioLines } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { StudioView } from "@/lib/pronunciation";

// The pronunciation studio (E-37, D-21). Each row is a CORRECT Italian line drawn from
// the learner's own pronunciation signal — the `pronunciation` finding category and
// the "Erika also noticed" richness note. Hear it, say it back, hear yourself. The old
// treatment was a typed cloze that could not test the thing it was about (RETRO-003).
//
// Scoring is an OPTIONAL layer: with an Azure key a take can also be assessed per word
// and per sound. Without one the studio is unchanged and complete — "Last N" simply
// never appears, and nothing pretends to be a measurement.
//
// DESIGN: calm rows, ink accent, one signature stagger, no colour except the semantic
// score band. No streaks, no confetti, no celebratory beat (D-24).

export default function StudioListPage() {
  const reduced = usePrefersReducedMotion();
  const [view, setView] = useState<StudioView | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/pronunciation")
      .then((r) => r.json())
      .then((v: StudioView) => alive && setView(v))
      .catch(() => alive && setView(null));
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

  if (view === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Gathering lines to say…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      {back}
      <h1 className="mb-2 text-[34px] font-bold tracking-tight">Studio</h1>
      <p className="mb-6 text-[17px] text-secondary">
        Hear a line, then say it back. You get a score for each word and each sound.
      </p>

      {!view.scoringAvailable && (
        <p data-studio-unscored className="mb-6 text-[15px] text-secondary">
          Takes are not scored on this server — that is an optional extra. The drills work the
          same way without it: hear the line, say it back, hear yourself.
        </p>
      )}

      {view.sounds.length > 0 && (
        <section data-studio-sounds className="mb-6 flex flex-col gap-2">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Sounds at your edge
          </span>
          <div className="flex flex-wrap gap-1.5">
            {view.sounds.map((s) => (
              <span
                key={s.itemId}
                data-sound
                className="rounded-control bg-black/[0.06] px-2.5 py-1 text-[15px] text-ink dark:bg-white/[0.08]"
              >
                /{s.symbol}/
              </span>
            ))}
          </div>
          <p className="text-[13px] text-secondary">
            Sounds you have missed in a drill. They come back through the lines below.
          </p>
        </section>
      )}

      {view.drills.length === 0 ? (
        <p data-studio-empty className="text-[17px] text-secondary">
          No pronunciation drills yet. Record and analyze some speech — when Erika flags how
          something sounded, the correct line arrives here to say back.
        </p>
      ) : (
        <motion.ul
          variants={staggerContainer(reduced)}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-2"
        >
          {view.drills.map((d) => (
            <motion.li key={d.drillKey} variants={staggerItem(reduced)}>
              <Link
                href={`/practice/learn/studio/${encodeURIComponent(d.drillKey)}`}
                data-studio-drill
                className="flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <AudioLines size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
                  <span className="truncate text-[17px] text-ink" lang="it">
                    {d.referenceText}
                  </span>
                </span>
                <span className="tabular shrink-0 text-[15px] text-secondary">
                  {d.lastScore === null ? "Not tried" : `Last ${Math.round(d.lastScore)}`}
                </span>
              </Link>
            </motion.li>
          ))}
        </motion.ul>
      )}

      <p data-studio-notice className="mt-6 text-[13px] leading-[1.5] text-secondary">
        {view.notice}
      </p>
    </div>
  );
}
