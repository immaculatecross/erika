"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { checkFillIn, lessonScore, masteryPercent, type Exercise } from "@/lib/lessons/lessons-view";
import { useLesson, type GradeOutcome } from "@/lib/use-lesson";

// The lesson runner (E-6b, WO criteria 2-4). Opens a pattern's lesson (generated
// on first open, cached after — the hook handles the 402 budget state), shows the
// short explanation, then steps through the exercises one in focus at a time.
// Each exercise resolves to right/wrong (green/red only where the state carries
// meaning, D-14) before Next unlocks; finishing posts the score and shows the new
// mastery. Content staggers in; reduced motion degrades to a fade via the shared
// variants. All grading of rewrites goes through the engine's grade route.

type Resolution = { done: true; correct: boolean } | { done: false };

/** A back link to the lessons list, shared by every phase of the runner. */
function BackToLessons() {
  return (
    <Link
      href="/practice/lessons"
      className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
    >
      <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
      Lessons
    </Link>
  );
}

function ResultLine({ correct, detail }: { correct: boolean; detail?: string }) {
  return (
    <p
      data-result
      data-correct={correct}
      className={`text-[15px] font-medium ${correct ? "text-good" : "text-severe"}`}
    >
      {correct ? "Correct" : "Not quite"}
      {detail ? <span className="font-normal text-secondary"> — {detail}</span> : null}
    </p>
  );
}

/** Multiple choice: pick an option, then it locks and marks right/wrong (criterion 3). */
function MultipleChoice({
  exercise,
  onResolve,
}: {
  exercise: Extract<Exercise, { type: "multiple_choice" }>;
  onResolve: (correct: boolean) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const resolved = picked !== null;

  function choose(i: number) {
    if (resolved) return;
    setPicked(i);
    onResolve(i === exercise.answerIndex);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>
      <div className="flex flex-col gap-2">
        {exercise.options.map((option, i) => {
          const isAnswer = i === exercise.answerIndex;
          const isPicked = picked === i;
          // After resolving, tint the correct option green and a wrong pick red.
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
              data-picked={isPicked ? "true" : undefined}
              disabled={resolved}
              onClick={() => choose(i)}
              className={`rounded-control border px-4 py-2.5 text-left text-[15px] transition-colors active:scale-[0.99] disabled:cursor-default ${tone}`}
            >
              {option}
            </button>
          );
        })}
      </div>
      {resolved ? <ResultLine correct={picked === exercise.answerIndex} /> : null}
    </div>
  );
}

/** Fill-in: type an answer, checked case/whitespace-insensitively (criterion 3). */
function FillIn({
  exercise,
  onResolve,
}: {
  exercise: Extract<Exercise, { type: "fill_in" }>;
  onResolve: (correct: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [correct, setCorrect] = useState<boolean | null>(null);
  const resolved = correct !== null;

  function check() {
    if (resolved || value.trim() === "") return;
    const ok = checkFillIn(exercise.answer, value);
    setCorrect(ok);
    onResolve(ok);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>
      <input
        data-fill-input
        value={value}
        disabled={resolved}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && check()}
        placeholder="Type your answer"
        className="rounded-control border border-hairline bg-card px-4 py-2.5 text-[15px] text-ink outline-none focus:border-ink disabled:opacity-70"
      />
      {resolved ? (
        <ResultLine correct={correct} detail={correct ? undefined : `answer: ${exercise.answer}`} />
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

/** Rewrite: type a rewrite, graded by the model via POST /api/lessons/grade (criterion 3). */
function Rewrite({
  exercise,
  grade,
  onResolve,
}: {
  exercise: Extract<Exercise, { type: "rewrite" }>;
  grade: (target: string, rewrite: string) => Promise<GradeOutcome>;
  onResolve: (correct: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [verdict, setVerdict] = useState<{ correct: boolean; feedback: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolved = verdict !== null;

  async function submit() {
    if (resolved || busy || value.trim() === "") return;
    setBusy(true);
    setNote(null);
    const outcome = await grade(exercise.target, value);
    setBusy(false);
    if ("budget" in outcome) {
      setNote("The monthly budget is reached, so this rewrite can't be graded right now.");
      return;
    }
    if ("error" in outcome) {
      setNote(outcome.error);
      return;
    }
    setVerdict(outcome);
    onResolve(outcome.correct);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>
      <textarea
        data-rewrite-input
        value={value}
        disabled={resolved}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        placeholder="Write your version"
        className="resize-none rounded-control border border-hairline bg-card px-4 py-2.5 text-[15px] text-ink outline-none focus:border-ink disabled:opacity-70"
      />
      {resolved ? (
        <p
          data-grade-feedback
          data-correct={verdict.correct}
          className={`text-[15px] font-medium ${verdict.correct ? "text-good" : "text-severe"}`}
        >
          {verdict.correct ? "Correct" : "Not quite"}
          <span className="font-normal text-secondary"> — {verdict.feedback}</span>
        </p>
      ) : (
        <>
          <button
            type="button"
            data-grade
            disabled={value.trim() === "" || busy}
            onClick={() => void submit()}
            className="self-start rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {busy ? "Grading…" : "Submit rewrite"}
          </button>
          {note ? <p className="text-[15px] text-secondary">{note}</p> : null}
        </>
      )}
    </div>
  );
}

/** Render whichever exercise kind is in focus, threading its resolution up. */
function ExerciseCard({
  exercise,
  grade,
  onResolve,
}: {
  exercise: Exercise;
  grade: (target: string, rewrite: string) => Promise<GradeOutcome>;
  onResolve: (correct: boolean) => void;
}) {
  if (exercise.type === "multiple_choice") return <MultipleChoice exercise={exercise} onResolve={onResolve} />;
  if (exercise.type === "fill_in") return <FillIn exercise={exercise} onResolve={onResolve} />;
  return <Rewrite exercise={exercise} grade={grade} onResolve={onResolve} />;
}

export function LessonRunner({ patternKey }: { patternKey: string }) {
  const reduced = usePrefersReducedMotion();
  const { state, grade, complete } = useLesson(patternKey);
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [step, setStep] = useState<Resolution>({ done: false });
  const [mastery, setMastery] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);

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
        <BackToLessons />
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
        <BackToLessons />
        <h1 className="text-[34px] font-bold tracking-tight">Lesson unavailable</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">{state.message}</p>
      </div>
    );
  }

  const { lesson } = state;
  const total = lesson.exercises.length;
  const last = index === total - 1;

  function resolve(correct: boolean) {
    setStep({ done: true, correct });
    if (correct) setCorrectCount((c) => c + 1);
  }

  async function advance() {
    if (!last) {
      setIndex((i) => i + 1);
      setStep({ done: false });
      return;
    }
    setFinishing(true);
    const next = await complete(lessonScore(correctCount, total));
    setFinishing(false);
    setMastery(next ?? 0);
  }

  if (mastery !== null) {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 p-8">
        <BackToLessons />
        <div data-lesson-complete className="flex flex-col gap-3">
          <h1 className="text-[34px] font-bold tracking-tight">Lesson complete</h1>
          <p className="text-[17px] text-secondary">
            You answered{" "}
            <span className="tabular font-semibold text-ink">
              {correctCount} of {total}
            </span>{" "}
            correctly.
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
              Mastery
            </span>
            <div className="flex items-center gap-3">
              <div className="h-2 w-40 overflow-hidden rounded-full bg-hairline">
                <div className="h-full rounded-full bg-good" style={{ width: `${masteryPercent(mastery)}%` }} />
              </div>
              <span data-mastery className="tabular text-[17px] font-semibold text-ink">
                {masteryPercent(mastery)}%
              </span>
            </div>
          </div>
        </div>
        <Link
          href="/practice/lessons"
          className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Back to lessons
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <BackToLessons />
      </div>

      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-lesson-runner
        className="flex flex-col gap-6"
      >
        <motion.p
          variants={staggerItem(reduced)}
          data-lesson-explanation
          className="rounded-card bg-card p-5 text-[17px] leading-[1.47] text-ink shadow-card"
        >
          {lesson.explanation}
        </motion.p>

        <motion.div variants={staggerItem(reduced)} className="flex items-center justify-between">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Exercise <span className="tabular">{index + 1}</span> of{" "}
            <span className="tabular">{total}</span>
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
          <ExerciseCard exercise={lesson.exercises[index]} grade={grade} onResolve={resolve} />
        </motion.div>

        <motion.div variants={staggerItem(reduced)}>
          <button
            type="button"
            data-next={last ? undefined : "true"}
            data-finish={last ? "true" : undefined}
            disabled={!step.done || finishing}
            onClick={() => void advance()}
            className="rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {finishing ? "Saving…" : last ? "Finish lesson" : "Next exercise"}
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
