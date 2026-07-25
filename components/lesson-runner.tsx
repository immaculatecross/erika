"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { itemLessonScore, type ItemLesson } from "@/lib/lessons/item-lessons-view";
import { MISHEARD_STREAK_TO_FALL_BACK } from "@/lib/lessons/spoken-answer";
import { useItemLesson } from "@/lib/use-item-lesson";
import { DrillCard, type DrillOutcome } from "@/components/drill-card";

// THE lesson runner — the one that survives (E-45 criterion 1). Two runners with
// two exercise vocabularies became one: `components/item-lesson-runner.tsx` is
// deleted, and this file, which used to run pattern lessons with a typed fill-in and
// a MODEL-GRADED rewrite, now runs the single format.
//
// A lesson is: an explanation in plain English, a few worked Italian examples at the
// D-23 register, optionally the words it teaches, then drills answered by tapping or
// by speaking. Sized to five minutes or less by lib/lessons/lesson-budget.ts, which
// enforces the size on the content rather than promising it in copy.
//
// Feedback is CORRECTION-FORWARD (D-18): the correct form is headlined with its
// reason. The stimulus is never an error form, so there is no error to subordinate.

type Resolution = { done: true; outcome: DrillOutcome } | { done: false };

function BackToItems() {
  return (
    <Link
      href="/practice/learn"
      className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
    >
      <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
      Today&apos;s items
    </Link>
  );
}

function LessonBody({
  lesson,
  complete,
}: {
  lesson: ItemLesson;
  complete: (correct: boolean) => Promise<unknown>;
}) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [step, setStep] = useState<Resolution>({ done: false });
  const [mishearings, setMishearings] = useState(0);
  const [finished, setFinished] = useState(false);

  const total = lesson.exercises.length;
  const last = index === total - 1;
  // Three consecutive "that's not what I said" and speech stops being offered for
  // the rest of the session. See components/drill-card.tsx for the reasoning.
  const speechOffered = mishearings < MISHEARD_STREAK_TO_FALL_BACK;

  function resolve(outcome: DrillOutcome) {
    setStep({ done: true, outcome });
    if (outcome === "misheard") {
      // A mishearing is NOT a wrong answer and NOT a verified right one. It counts
      // toward the day (the learner did the drill) and writes NO evidence — we did
      // not verify the answer, and we have no reason to hold it against them.
      setMishearings((n) => n + 1);
      setCorrectCount((c) => c + 1);
      return;
    }
    setMishearings(0);
    if (outcome === "correct") setCorrectCount((c) => c + 1);
    void complete(outcome === "correct"); // cued evidence (best-effort)
  }

  function advance() {
    if (!last) {
      setIndex((i) => i + 1);
      setStep({ done: false });
      return;
    }
    setFinished(true);
  }

  if (finished) {
    const scorePct = Math.round(itemLessonScore(correctCount, total) * 100);
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
        <BackToItems />
        <div data-lesson-complete className="flex flex-col gap-3">
          <h1 className="text-[34px] font-bold tracking-tight">Lesson complete</h1>
          <p className="text-[17px] text-secondary">
            You answered{" "}
            <span className="tabular font-semibold text-ink">
              {correctCount} of {total}
            </span>{" "}
            correctly<span className="tabular"> ({scorePct}%)</span>.
          </p>
        </div>
        <Link
          href="/practice/learn"
          className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Back to today&apos;s items
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <BackToItems />
      </div>
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-lesson-runner
        data-lesson-kind={lesson.kind}
        data-deterministic={lesson.deterministic ? "true" : undefined}
        className="flex flex-col gap-6"
      >
        <motion.p
          variants={staggerItem(reduced)}
          data-lesson-intro
          className="rounded-card bg-card p-5 text-[17px] leading-[1.47] text-ink shadow-card"
        >
          {lesson.intro}
        </motion.p>

        {lesson.examples.length > 0 && (
          <motion.ul variants={staggerItem(reduced)} data-lesson-examples className="flex flex-col gap-2">
            {lesson.examples.map((example) => (
              <li key={example} className="text-[17px] leading-[1.47] text-ink">
                {example}
              </li>
            ))}
          </motion.ul>
        )}

        {lesson.newWords.length > 0 && (
          <motion.ul variants={staggerItem(reduced)} data-lesson-words className="flex flex-col gap-2">
            {lesson.newWords.map((w) => (
              <li key={w.lemma} className="flex flex-wrap items-baseline gap-2">
                <span className="text-[17px] font-semibold text-ink">{w.lemma}</span>
                <span className="text-[15px] text-secondary">{w.gloss}</span>
              </li>
            ))}
          </motion.ul>
        )}

        <motion.div variants={staggerItem(reduced)} className="flex items-center justify-between">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Exercise <span className="tabular">{index + 1}</span> of <span className="tabular">{total}</span>
          </span>
        </motion.div>

        {!speechOffered && (
          <motion.p variants={staggerItem(reduced)} data-speech-fallback className="text-[13px] text-secondary">
            Speech recognition isn&apos;t hearing you well today. The rest of the drills are tap-only.
          </motion.p>
        )}

        <motion.div
          key={index}
          variants={staggerItem(reduced)}
          data-exercise
          data-exercise-invite={lesson.exercises[index].invite}
          data-resolved={step.done ? "true" : "false"}
          className="rounded-card bg-card p-5 shadow-card"
        >
          <DrillCard
            key={index}
            exercise={lesson.exercises[index]}
            speechOffered={speechOffered}
            onResolve={resolve}
          />
        </motion.div>

        <motion.div variants={staggerItem(reduced)}>
          <button
            type="button"
            data-next={last ? undefined : "true"}
            data-finish={last ? "true" : undefined}
            disabled={!step.done}
            onClick={advance}
            className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {last ? "Finish lesson" : "Next exercise"}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}

export function LessonRunner({ itemId }: { itemId: string }) {
  const { state, complete } = useItemLesson(itemId);

  if (state.phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Opening your lesson…</p>
      </div>
    );
  }

  // There is no budget branch and no "unavailable right now" branch any more.
  // `todaysLesson` cannot fail: a lesson that cannot be generated falls back to the
  // syllabus lesson, which needs no key, no budget and no network (D-27). The only
  // remaining refusal is a knowledge item with no lesson format at all — a phone,
  // which belongs to the pronunciation studio — and that is routing, not an error.
  if (state.phase === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
        <BackToItems />
        <h1 className="text-[34px] font-bold tracking-tight">Nothing to practise here</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">{state.message}</p>
      </div>
    );
  }

  return <LessonBody lesson={state.lesson} complete={complete} />;
}
