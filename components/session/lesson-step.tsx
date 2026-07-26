"use client";

import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { StepNotice } from "./step-notice";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

// Step one: the teaching (E-44, D-27). The syllabus is the backbone, so this is where
// a rule from E-26's 266-rule A1→C2 curriculum, chosen at the learner's own knowledge
// edge, is explained.
//
// It renders the model-written intro when there is one, and the syllabus's OWN
// authored description and correct examples when there is not. Both are real lessons.
// The examples are shown in both cases: they are E-26's, they are correct Italian, and
// a rule with worked examples reads better than a paragraph alone.
//
// D-18 holds: nothing here is an error form. Every Italian sentence on this screen is
// correct, because the learner has not been asked to produce anything yet.

export function LessonStep({
  data,
  onRetry,
  onDone,
}: {
  data: SessionLessonBody;
  onRetry: () => void;
  onDone: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const title = data.fallback?.title ?? data.label ?? "Today's lesson";
  const body = data.lesson?.intro ?? data.fallback?.description ?? null;
  const definition = data.lesson?.definition ?? null;
  const examples = data.lesson?.examples ?? data.fallback?.examples ?? [];
  const words = data.lesson?.newWords ?? [];

  return (
    <motion.div
      variants={staggerContainer(reduced)}
      initial="initial"
      animate="animate"
      data-step-lesson
      data-lesson-source={data.lesson?.deterministic ? "syllabus" : data.lesson ? "generated" : "syllabus"}
      className="flex flex-col gap-5"
    >
      <motion.div variants={staggerItem(reduced)} className="flex flex-col gap-1">
        {data.fallback && (
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            {data.fallback.cefr}
          </span>
        )}
        <h1 data-lesson-title className="text-[34px] font-bold tracking-tight">
          {title}
        </h1>
      </motion.div>

      {body && (
        <motion.p
          variants={staggerItem(reduced)}
          data-lesson-intro
          className="rounded-card bg-card p-5 text-[17px] leading-[1.47] text-ink shadow-card"
        >
          {body}
        </motion.p>
      )}

      {definition && (
        <motion.p variants={staggerItem(reduced)} data-lesson-definition className="text-[17px] leading-[1.47] text-ink">
          {definition}
        </motion.p>
      )}

      {words.length > 0 && (
        <motion.ul variants={staggerItem(reduced)} data-lesson-words className="flex flex-col gap-2">
          {words.map((word) => (
            <li key={word.lemma} className="flex flex-col rounded-control bg-card px-4 py-3 shadow-card">
              <span className="text-[17px] font-semibold text-ink">{word.lemma}</span>
              <span className="text-[15px] text-secondary">{word.definition}</span>
              {word.example && <span className="mt-1 text-[15px] text-ink">{word.example}</span>}
            </li>
          ))}
        </motion.ul>
      )}

      {examples.length > 0 && (
        <motion.ul variants={staggerItem(reduced)} data-lesson-examples className="flex flex-col gap-2">
          {examples.map((ex) => (
            <li key={ex} className="rounded-control bg-card px-4 py-3 text-[17px] text-ink shadow-card">
              {ex}
            </li>
          ))}
        </motion.ul>
      )}

      {data.notice && (
        <motion.div variants={staggerItem(reduced)}>
          <StepNotice reason={data.notice} onRetry={onRetry} />
        </motion.div>
      )}

      <motion.button
        variants={staggerItem(reduced)}
        type="button"
        data-step-continue
        onClick={onDone}
        className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
      >
        Continue
      </motion.button>
    </motion.div>
  );
}
