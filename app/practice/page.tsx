"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { GoalRing } from "@/components/goal-ring";
import { formatEstimate } from "@/lib/format";
import type { TodayView } from "@/lib/today";

// The Learn TODAY home (E-31, D-24), over the E-30 Learn tab. Not an interstitial:
// today's plan, composed from the user's own recorded material first. The ink goal
// ring is the one habit ornament; a factual completion sentence appears once per day
// when the goal is met (no confetti, no XP, no second beat). Below it, the day's
// actionable rows — the review drill, the one lesson the ranking prescribes, the
// letter while unread — plus a quiet count of the new items the composer queued at
// the knowledge edge. The tutor row arrives with E-34; its slot waits.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";
const ROW =
  "flex items-center justify-between gap-4 rounded-card bg-card p-5 shadow-card transition-transform active:scale-[0.99]";

/** The one factual completion sentence (D-24) — numbers, never a cheer. */
function completionSentence(c: { cardsDone: number; lessonsDone: number }): string {
  const cards = `${c.cardsDone} ${c.cardsDone === 1 ? "card" : "cards"}`;
  const lessons = c.lessonsDone > 0 ? `, ${c.lessonsDone === 1 ? "one lesson" : `${c.lessonsDone} lessons`}` : "";
  return `Done for today. ${cards}${lessons}.`;
}

export default function LearnTodayPage() {
  const reduced = usePrefersReducedMotion();
  const [today, setToday] = useState<TodayView | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      await fetch("/api/cards/generate", { method: "POST" });
      const res = await fetch("/api/learn/today");
      let view = (await res.json()) as TodayView;
      // Goal met but not yet recorded → record it (authoritative server check) and
      // reflect the completion so the ring closes and the sentence appears, once.
      if (!view.complete && view.goal.total > 0 && view.dueCount === 0) {
        const done = await fetch("/api/day/complete", { method: "POST" });
        const body = (await done.json()) as {
          complete: boolean;
          completion?: { cardsDone: number; lessonsDone: number };
        };
        if (body.complete && body.completion) {
          view = { ...view, complete: true, completion: body.completion };
        }
      }
      if (alive) setToday(view);
    })().catch(() => {
      if (alive)
        setToday({
          day: "",
          goal: { done: 0, total: 0 },
          complete: false,
          completion: null,
          dueCount: 0,
          lesson: null,
          letterUnread: false,
          newItems: { vocab: 0, rules: 0, pronunciation: 0 },
          placed: true,
        });
    });
    return () => {
      alive = false;
    };
  }, []);

  if (today === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Composing today&rsquo;s plan…</p>
      </div>
    );
  }

  const newTotal = today.newItems.vocab + today.newItems.rules + today.newItems.pronunciation;
  const nothing =
    today.placed &&
    today.goal.total === 0 &&
    today.lesson === null &&
    !today.letterUnread &&
    !today.complete &&
    newTotal === 0;

  if (nothing) {
    return (
      <EmptyState
        title="Today"
        line="Nothing to practice right now. Your day fills in once Erika has heard you speak — and cards return when their next review comes around."
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
    <div data-learn-today className="mx-auto max-w-2xl p-8">
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-6"
      >
        <motion.header variants={staggerItem(reduced)}>
          <h1 className="text-[34px] font-bold tracking-tight">Today</h1>
          <p className="mt-1 text-[17px] text-secondary">Your day, from your own speech.</p>
        </motion.header>

        {/* First-run placement (E-35): until the learner is placed, the composer
            guesses A1. A calm prompt to find their level — never a hard gate. */}
        {!today.placed && (
          <motion.section variants={staggerItem(reduced)} data-placement-prompt className="flex flex-col gap-3">
            <span className={CAPTION}>Start here</span>
            <Link href="/practice/placement" data-open-placement className={ROW}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[17px] font-semibold text-ink">Find your level</span>
                <span className="text-[15px] text-secondary">
                  A few minutes of quick yes/no, so your lessons begin near your level — not at the alphabet.
                </span>
              </span>
              <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
            </Link>
          </motion.section>
        )}

        {/* The ring + the one factual completion beat (D-24). */}
        <motion.section
          variants={staggerItem(reduced)}
          data-today-goal
          className="flex flex-col items-center gap-4 rounded-card bg-card p-8 shadow-card"
        >
          <GoalRing done={today.goal.done} total={today.goal.total} />
          {today.complete && today.completion ? (
            <p data-completion className="text-[17px] text-ink">
              {completionSentence(today.completion)}
            </p>
          ) : today.goal.total > 0 ? (
            <p className="tabular text-[15px] text-secondary">
              {today.goal.done} of {today.goal.total} done today
            </p>
          ) : (
            <p className="text-[15px] text-secondary">Nothing due — your day is clear.</p>
          )}
        </motion.section>

        {/* Review drill. */}
        <motion.section variants={staggerItem(reduced)} data-today-cards className="flex flex-col gap-3">
          <span className={CAPTION}>Review</span>
          {today.dueCount > 0 ? (
            <div className={ROW}>
              <p className="text-[17px] text-secondary">
                <span data-due-count className="tabular font-semibold text-ink">
                  {today.dueCount}
                </span>{" "}
                {today.dueCount === 1 ? "card" : "cards"} due for review.
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

        {/* The spoken tutor (E-34, D-24): a conversation steered toward your own
            recurring mistakes; it records like any session, so it still yields
            findings. Estimate + cap live on the tutor surface. */}
        <motion.section variants={staggerItem(reduced)} data-today-tutor className="flex flex-col gap-3">
          <span className={CAPTION}>Speak</span>
          <Link href="/practice/tutor" data-open-tutor className={ROW}>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-[17px] font-semibold text-ink">Talk with Erika</span>
              <span className="text-[15px] text-secondary">
                A spoken conversation, steered toward your slips and today&rsquo;s targets.
              </span>
            </span>
            <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
          </Link>
        </motion.section>

        {/* The one lesson the ranking prescribes (E-18, reused). */}
        {today.lesson && (
          <motion.section variants={staggerItem(reduced)} data-today-lesson className="flex flex-col gap-3">
            <span className={CAPTION}>Work on next</span>
            <Link href={`/practice/lessons/${encodeURIComponent(today.lesson.key)}`} className={ROW}>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="text-[17px] font-semibold capitalize text-ink">{today.lesson.category}</span>
                <span className="tabular text-[15px] text-secondary">
                  {today.lesson.count} {today.lesson.count === 1 ? "finding" : "findings"} — your costliest
                  pattern right now.
                </span>
              </span>
              <span data-lesson-price className="tabular shrink-0 text-[15px] font-medium text-secondary">
                {today.lesson.ready ? "Lesson ready" : `Generate — est. ${formatEstimate(today.lesson.estimateUsd ?? 0)}`}
              </span>
            </Link>
          </motion.section>
        )}

        {/* New material the composer queued at the knowledge edge. Grammar and
            vocabulary are doable micro-lessons (E-32); pronunciation ("sounds")
            routes to the studio (E-37), where a sound is practised through a real
            scored drill. */}
        {newTotal > 0 && (
          <motion.section variants={staggerItem(reduced)} data-today-new className="flex flex-col gap-3">
            <span className={CAPTION}>New today</span>
            {today.newItems.vocab + today.newItems.rules > 0 ? (
              <Link href="/practice/learn" data-today-new-items className={ROW}>
                <span className="tabular text-[15px] text-secondary">
                  {[
                    today.newItems.vocab > 0
                      ? `${today.newItems.vocab} ${today.newItems.vocab === 1 ? "word" : "words"}`
                      : null,
                    today.newItems.rules > 0
                      ? `${today.newItems.rules} ${today.newItems.rules === 1 ? "rule" : "rules"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  at your edge.
                </span>
                <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
              </Link>
            ) : (
              <Link href="/practice/learn/studio" data-today-new-sounds className={ROW}>
                <span className="tabular text-[15px] text-secondary">
                  {today.newItems.pronunciation} sounds at your edge.
                </span>
                <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
              </Link>
            )}
          </motion.section>
        )}

        {today.letterUnread && (
          <motion.section variants={staggerItem(reduced)} data-today-letter className="flex flex-col gap-3">
            <span className={CAPTION}>This week</span>
            <Link href="/letter" className={ROW}>
              <span className="text-[17px] text-ink">Your letter for the week is waiting.</span>
              <ArrowRight size={20} strokeWidth={1.5} className="shrink-0 text-secondary" aria-hidden />
            </Link>
          </motion.section>
        )}

        <motion.div variants={staggerItem(reduced)} className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          {/* The E-33 voice & canon formats (D-23, D-19). */}
          <Link
            href="/practice/reading"
            data-open-reading
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Reading
          </Link>
          <Link
            href="/practice/learn/shadow"
            data-open-shadow
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Shadow
          </Link>
          {/* The E-37 pronunciation studio (D-21): hear a correct line, say it back,
              get a per-word and per-sound score. */}
          <Link
            href="/practice/learn/studio"
            data-open-studio
            className="text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Studio
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}
