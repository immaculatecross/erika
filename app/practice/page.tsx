"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { formatUsd } from "@/lib/format";
import type { Plan } from "@/lib/plan";

// The Practice screen as a daily plan (E-18 criterion 1): not an interstitial but
// a prescription for today — the due-card queue, the one lesson Focus's
// severity-weighted ranking says to work on next (the same ranking, reused), and
// this week's letter while it is unread. On arrival it still generates cards from
// any new findings (idempotently) before reading the plan. Quiet, no gamification:
// each row is a fact and a way in. Content staggers; reduced motion fades.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";
const ROW =
  "flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]";

export default function PracticePage() {
  const reduced = usePrefersReducedMotion();
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await fetch("/api/cards/generate", { method: "POST" });
      const res = await fetch("/api/plan");
      const body = (await res.json()) as Plan;
      if (alive) setPlan(body);
    })().catch(() => {
      if (alive) setPlan({ dueCount: 0, lesson: null, letterWeek: null, letterUnread: false });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (plan === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Composing today&rsquo;s plan…</p>
      </div>
    );
  }

  // Nothing to prescribe at all: before any speech is analyzed the honest plan
  // is to go make some — a real link, not a disabled button (RETRO-001).
  if (plan.dueCount === 0 && plan.lesson === null && !plan.letterUnread) {
    return (
      <EmptyState
        title="Practice"
        line="Nothing to practice right now. Your plan fills in once Erika has heard you speak — and cards return when their next review comes around."
        action="Go to sessions"
        href="/"
        secondary={
          <Link
            href="/practice/cards"
            data-browse-cards
            className="rounded-full bg-page px-5 py-2.5 text-[15px] font-medium text-ink transition-transform active:scale-[0.98]"
          >
            Browse all cards
          </Link>
        }
      />
    );
  }

  return (
    <div data-practice className="mx-auto max-w-2xl p-8">
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-6"
      >
        <motion.header variants={staggerItem(reduced)}>
          <h1 className="text-[34px] font-bold tracking-tight">Practice</h1>
          <p className="mt-1 text-[17px] text-secondary">Today&rsquo;s plan.</p>
        </motion.header>

        <motion.section variants={staggerItem(reduced)} data-plan-cards className="flex flex-col gap-3">
          <span className={CAPTION}>Review</span>
          {plan.dueCount > 0 ? (
            <div className={ROW}>
              <p className="text-[17px] text-secondary">
                <span data-due-count className="tabular font-semibold text-ink">
                  {plan.dueCount}
                </span>{" "}
                {plan.dueCount === 1 ? "card" : "cards"} due for review.
              </p>
              <Link
                href="/practice/review"
                data-start-practice
                className="shrink-0 rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
              >
                Start the drill
              </Link>
            </div>
          ) : (
            <div className={ROW}>
              <p className="text-[15px] text-secondary">
                Nothing due — cards return when their next review comes around.
              </p>
            </div>
          )}
        </motion.section>

        {plan.lesson && (
          <motion.section variants={staggerItem(reduced)} data-plan-lesson className="flex flex-col gap-3">
            <span className={CAPTION}>Work on next</span>
            <Link href={`/practice/lessons/${encodeURIComponent(plan.lesson.key)}`} className={ROW}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[17px] font-semibold capitalize text-ink">
                  {plan.lesson.category}
                </span>
                <span className="tabular text-[15px] text-secondary">
                  {plan.lesson.count} {plan.lesson.count === 1 ? "finding" : "findings"} — your
                  costliest pattern right now.
                </span>
              </span>
              <span data-lesson-price className="tabular shrink-0 text-[15px] font-medium text-secondary">
                {plan.lesson.ready ? "Lesson ready" : `Generate — est. ${formatUsd(plan.lesson.estimateUsd ?? 0)}`}
              </span>
            </Link>
          </motion.section>
        )}

        {plan.letterUnread && plan.letterWeek && (
          <motion.section variants={staggerItem(reduced)} data-plan-letter className="flex flex-col gap-3">
            <span className={CAPTION}>This week</span>
            <Link href="/letter" className={ROW}>
              <span className="text-[17px] text-ink">Your letter for the week is waiting.</span>
              <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
            </Link>
          </motion.section>
        )}

        <motion.div variants={staggerItem(reduced)} className="flex items-center gap-5">
          <Link
            href="/practice/cards"
            data-browse-cards
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Browse all cards
          </Link>
          <Link
            href="/practice/lessons"
            data-work-on-pattern
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            All lessons
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
