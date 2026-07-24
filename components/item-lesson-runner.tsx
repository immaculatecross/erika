"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import {
  gradeItemExercise,
  itemLessonScore,
  type ItemExercise,
  type ItemLesson,
} from "@/lib/lessons/item-lessons-view";
import { useItemLesson } from "@/lib/use-item-lesson";

// The E-32 item-lesson runner (WO criteria 1-4). Opens a composer-chosen item's
// lesson (generated on first open, cached after — the hook handles the 402 budget
// state), shows the explanation/intro, then steps through meaning-first exercises
// one at a time. Each resolves to right/wrong (green/red only where the state
// carries meaning, D-14) and writes cued evidence to the knowledge core. Feedback is
// CORRECTION-FORWARD (D-18): the correct form is headlined with its rationale — the
// stimulus is never an error form, so there is no error to subordinate here.

type Resolution = { done: true; correct: boolean } | { done: false };

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

/** Correction-forward feedback: verdict, then the correct form + why (D-18). */
function Feedback({ exercise, correct }: { exercise: ItemExercise; correct: boolean }) {
  return (
    <div data-feedback className="flex flex-col gap-1.5">
      <p data-correct={correct} className={`text-[15px] font-medium ${correct ? "text-good" : "text-severe"}`}>
        {correct ? "Correct" : "Not quite"}
      </p>
      <p className="text-[15px] text-ink">
        <span className="text-secondary">Answer: </span>
        <span data-answer className="font-medium">{exercise.answer}</span>
      </p>
      <p className="text-[15px] text-secondary">{exercise.rationale}</p>
    </div>
  );
}

/** The meaning-first cue, with an English gloss front when one was attached (P4). */
function Cue({ exercise }: { exercise: ItemExercise }) {
  return (
    <div className="flex flex-col gap-1.5">
      {exercise.gloss ? (
        <p data-gloss className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {exercise.gloss}
        </p>
      ) : null}
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>
    </div>
  );
}

function MultipleChoice({ exercise, onResolve }: { exercise: ItemExercise; onResolve: (c: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const resolved = picked !== null;
  const options = exercise.options ?? [];

  function choose(i: number) {
    if (resolved) return;
    setPicked(i);
    onResolve(gradeItemExercise(exercise, i));
  }

  return (
    <div className="flex flex-col gap-3">
      <Cue exercise={exercise} />
      <div className="flex flex-col gap-2">
        {options.map((option, i) => {
          const isAnswer = i === exercise.answerIndex;
          const isPicked = picked === i;
          const tone = resolved
            ? isAnswer
              ? "border-good bg-good/[0.12] text-ink"
              : isPicked
                ? "border-severe bg-severe/[0.12] text-ink"
                : "border-hairline text-secondary"
            : "border-hairline text-ink hover:border-ink";
          return (
            <button
              key={i}
              type="button"
              data-option
              data-correct={resolved && isAnswer ? "true" : undefined}
              disabled={resolved}
              onClick={() => choose(i)}
              className={`rounded-control border px-4 py-2.5 text-left text-[15px] transition-colors active:scale-[0.99] disabled:cursor-default ${tone}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {resolved ? <Feedback exercise={exercise} correct={picked === exercise.answerIndex} /> : null}
    </div>
  );
}

function Cloze({ exercise, onResolve }: { exercise: ItemExercise; onResolve: (c: boolean) => void }) {
  const [value, setValue] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const resolved = correct !== null;

  function check() {
    if (resolved || value.trim() === "") return;
    const ok = gradeItemExercise(exercise, value);
    setCorrect(ok);
    onResolve(ok);
  }

  return (
    <div className="flex flex-col gap-3">
      <Cue exercise={exercise} />
      <input
        data-cloze-input
        value={value}
        disabled={resolved}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && check()}
        placeholder="Type your answer"
        className="rounded-control border border-hairline bg-card px-4 py-2.5 text-[15px] text-ink outline-none focus:border-ink disabled:opacity-70"
      />
      {resolved ? (
        <Feedback exercise={exercise} correct={correct} />
      ) : (
        <button
          type="button"
          data-check
          disabled={value.trim() === ""}
          onClick={check}
          className="self-start rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          Check
        </button>
      )}
    </div>
  );
}

function ExerciseCard({ exercise, onResolve }: { exercise: ItemExercise; onResolve: (c: boolean) => void }) {
  if (exercise.type === "multiple_choice") return <MultipleChoice exercise={exercise} onResolve={onResolve} />;
  return <Cloze exercise={exercise} onResolve={onResolve} />;
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
  const [finished, setFinished] = useState(false);

  const total = lesson.exercises.length;
  const last = index === total - 1;

  function resolve(correct: boolean) {
    setStep({ done: true, correct });
    if (correct) setCorrectCount((c) => c + 1);
    void complete(correct); // write cued evidence (best-effort; content unaffected)
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
        data-item-lesson-runner
        data-lesson-kind={lesson.kind}
        className="flex flex-col gap-6"
      >
        <motion.p
          variants={staggerItem(reduced)}
          data-lesson-intro
          className="rounded-card bg-card p-5 text-[17px] leading-[1.47] text-ink shadow-card"
        >
          {lesson.intro}
        </motion.p>

        <motion.div variants={staggerItem(reduced)} className="flex items-center justify-between">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Exercise <span className="tabular">{index + 1}</span> of <span className="tabular">{total}</span>
          </span>
        </motion.div>

        <motion.div
          key={index}
          variants={staggerItem(reduced)}
          data-exercise
          data-exercise-type={lesson.exercises[index].type}
          data-resolved={step.done ? "true" : "false"}
          className="rounded-card bg-card p-5 shadow-card"
        >
          <ExerciseCard exercise={lesson.exercises[index]} onResolve={resolve} />
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

export function ItemLessonRunner({ itemId }: { itemId: string }) {
  const { state, complete } = useItemLesson(itemId);

  if (state.phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Opening your lesson…</p>
      </div>
    );
  }

  if (state.phase === "budget") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
        <BackToItems />
        <h1 data-budget-reached className="text-[34px] font-bold tracking-tight">
          Monthly budget reached
        </h1>
        <p className="text-[17px] leading-[1.47] text-secondary">
          This lesson hasn&apos;t been generated yet, and the monthly budget is spent. It becomes
          available again next month, or raise the cap in Settings.
        </p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
        <BackToItems />
        <h1 className="text-[34px] font-bold tracking-tight">Lesson unavailable</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">{state.message}</p>
      </div>
    );
  }

  return <LessonBody lesson={state.lesson} complete={complete} />;
}
