"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { KnowledgeGrid } from "@/components/progress/knowledge-grid";
import { KIND_LABEL, KNOWN_EXPLAINER, kindLine, levelLine, weekLine, fossilLine } from "@/lib/progress-copy";
import { shortDate } from "@/lib/slip-standing";
import type { ProgressView } from "@/lib/progress";

// "What Erika knows about you" (E-46 criteria 6, 7, 8). Read-only, and the only
// surface in the product whose subject is the learner rather than the day.
//
// It replaces `/dev/knowledge`, which showed the same underlying tables as a
// developer's dump — kind/status rows, evidence counts by source — to an audience of
// nobody. What changed is not the data but the question: not "what is in the
// database" but "what have you shown you have".
//
// Restraint is the design (DESIGN.md). Four sections, one column, no charts, no
// gauges, no illustrations. Accent ink carries the three numbers that matter; green
// appears in exactly one place and only through resolved-slip semantics; there is
// one signature moment (the map settling in) and it lives in KnowledgeGrid. D-24's
// ban list is not a risk to be managed here, it is a temptation to be refused: a
// progress screen is where confetti, badges and streak theatrics try to arrive.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";
const CARD = "rounded-card bg-card p-5 shadow-card";

export default function ProgressPage() {
  const reduced = usePrefersReducedMotion();
  const [view, setView] = useState<ProgressView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/progress")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("progress"))))
      .then((body: ProgressView) => alive && setView(body))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <Column>
        <p className="text-[15px] text-secondary">
          Your progress could not be read just now. Reload the page to try again.
        </p>
      </Column>
    );
  }
  if (!view) {
    return (
      <Column>
        <p className="text-[15px] text-secondary">Reading what Erika knows…</p>
      </Column>
    );
  }

  return (
    <Column>
      <motion.div
        data-progress
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-9"
      >
        <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-2">
          <span className={CAPTION}>Progress</span>
          <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.022em]">What Erika knows about you</h1>
          <p data-level-line className="text-[17px] leading-[1.47] text-secondary">
            {levelLine(view)}
          </p>
        </motion.header>

        {/* The three counts. Ink, never green: a count is activity, not mastery. */}
        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-3">
          <span className={CAPTION}>Shown you have</span>
          <div className="grid grid-cols-3 gap-2.5">
            {view.kinds.map((k) => (
              <div key={k.kind} data-kind={k.kind} className={`${CARD} flex flex-col gap-1`}>
                <span data-known={k.known} className="tabular text-[28px] font-semibold leading-none text-ink">
                  {k.known}
                </span>
                <span className="text-[13px] font-medium text-ink">{KIND_LABEL[k.kind]}</span>
                <span className="tabular text-[13px] leading-[1.35] text-secondary">{kindLine(k)}</span>
              </div>
            ))}
          </div>
          <p className="text-[13px] leading-[1.4] text-secondary">{KNOWN_EXPLAINER}</p>
        </motion.section>

        {/* What moved this week. */}
        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-3">
          <span className={CAPTION}>This week</span>
          <p data-week-line className="text-[17px] text-ink">
            {weekLine(view.movedCount)}
          </p>
          {view.moved.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {view.moved.map((m, i) => (
                <motion.li
                  key={m.itemId}
                  data-moved={m.itemId}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
                  animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
                  transition={reduced ? { duration: 0.2 } : { type: "spring", stiffness: 260, damping: 28, delay: i * 0.035 }}
                  className={`${CARD} flex items-baseline justify-between gap-3 py-3.5`}
                >
                  <span className="min-w-0 truncate text-[17px] text-ink">{m.label}</span>
                  <span className="tabular shrink-0 text-[13px] text-secondary">{shortDate(m.lastDay)}</span>
                </motion.li>
              ))}
            </ul>
          )}
        </motion.section>

        {/* Still fossilized — the mistakes that keep coming back. */}
        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-3">
          <span className={CAPTION}>Still fossilized</span>
          <p data-fossil-line className="text-[17px] text-ink">
            {fossilLine(view)}
          </p>
          {view.fossilized.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {view.fossilized.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/slips/${f.id}`}
                    data-fossil={f.id}
                    className={`${CARD} flex items-center justify-between gap-3 transition-transform active:scale-[0.98]`}
                  >
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="truncate text-[17px] text-ink">{f.correction}</span>
                      <span className="tabular text-[13px] capitalize text-secondary">
                        {f.category} · {f.occurrences} times · last {shortDate(f.lastSeenAt)}
                      </span>
                    </span>
                    <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        {/* The map. The one place green appears, and only through resolution. */}
        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-3">
          <span className={CAPTION}>Knowledge map</span>
          <p className="text-[15px] leading-[1.47] text-secondary">
            Each area turns green only as its recurring mistakes stop coming back — never for practising.
          </p>
          <KnowledgeGrid cells={view.map} />
        </motion.section>
      </motion.div>
    </Column>
  );
}

function Column({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">{children}</div>;
}
