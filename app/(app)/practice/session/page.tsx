"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { LessonStep } from "@/components/session/lesson-step";
import { DrillsStep } from "@/components/session/drills-step";
import { LetterStep } from "@/components/session/letter-step";
import { ConversationStep } from "@/components/session/conversation-step";
import { StepNotice } from "@/components/session/step-notice";
import { completionSentence } from "@/lib/session/steps";
import type { SessionView } from "@/lib/session/view";
import type { SessionLessonBody } from "@/lib/session/lesson-body";
import type { DayFigures } from "@/lib/session/steps";

// THE SESSION (E-44, D-26). One route, one linear run: lesson → drills → letter (once
// a week) → conversation → done. The learner chooses nothing to progress.
//
// RESUMABLE BY CONSTRUCTION. There is no client-held cursor: the step to show is
// whatever the SERVER says is the first step not yet done (migration v30). Closing the
// tab, reloading, wandering off to the tutor and coming back — all land on the same
// step, because the position is a durable fact and not a piece of React state.
//
// One `step` at a time is mounted, so the session cannot present two things at once,
// and the header carries a progress caption and a way out that is not a dead end.

type Phase =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; view: SessionView };

export default function SessionPage() {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [lesson, setLesson] = useState<SessionLessonBody | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [figures, setFigures] = useState<DayFigures | null>(null);

  /** Open (or resume) today's session. Idempotent server-side, so a reload is free. */
  const start = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const res = await fetch("/api/session/start", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setPhase({ kind: "ready", view: (await res.json()) as SessionView });
    } catch {
      setPhase({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void start();
  }, [start]);

  /** Fetch today's lesson — cached lessons bill zero; a refusal comes back as a
   *  notice with the syllabus's own content beside it, never as an empty screen. */
  const loadLesson = useCallback(async () => {
    setLessonLoading(true);
    try {
      const res = await fetch("/api/session/lesson", { method: "POST" });
      setLesson(res.ok ? ((await res.json()) as SessionLessonBody) : null);
    } catch {
      setLesson(null);
    } finally {
      setLessonLoading(false);
    }
  }, []);

  const needsLesson =
    phase.kind === "ready" &&
    phase.view.lesson !== null &&
    (phase.view.step === "lesson" || phase.view.step === "drills");

  useEffect(() => {
    if (needsLesson && lesson === null && !lessonLoading) void loadLesson();
  }, [needsLesson, lesson, lessonLoading, loadLesson]);

  const finishStep = useCallback(async (step: string) => {
    try {
      const res = await fetch("/api/session/step", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const view = (await res.json()) as SessionView;
      setPhase({ kind: "ready", view });
      if (view.complete) {
        const done = await fetch("/api/day/complete", { method: "POST" });
        const body = (await done.json()) as { complete: boolean; completion?: DayFigures };
        if (body.complete && body.completion) setFigures(body.completion);
      }
    } catch {
      setPhase({ kind: "error" });
    }
  }, []);

  if (phase.kind === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Opening today&rsquo;s session…</p>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 p-8">
        <h1 className="text-[34px] font-bold tracking-tight">Today&rsquo;s session</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">
          The session could not be opened just now. Nothing you have done today is lost.
        </p>
        <button
          type="button"
          data-session-retry
          onClick={() => void start()}
          className="self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          Try again
        </button>
      </div>
    );
  }

  const { view } = phase;
  const position = view.step ? view.steps.indexOf(view.step) + 1 : view.steps.length;

  return (
    <div data-session data-session-step={view.step ?? "done"} className="mx-auto flex min-h-screen max-w-xl flex-col p-6">
      <header className="flex items-center justify-between">
        <Link
          href="/practice"
          data-exit-session
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
        >
          <X size={20} strokeWidth={1.5} aria-hidden />
          {view.complete ? "Done" : "Later"}
        </Link>
        {view.steps.length > 0 && (
          <span className="tabular text-[13px] font-medium text-secondary">
            {Math.min(position, view.steps.length)} / {view.steps.length}
          </span>
        )}
      </header>

      <motion.main
        key={view.step ?? "done"}
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0.2 } : SPRING}
        className="flex flex-1 flex-col justify-center gap-6 py-8"
      >
        {view.step === "lesson" &&
          (lesson ? (
            <LessonStep data={lesson} onRetry={() => void loadLesson()} onDone={() => void finishStep("lesson")} />
          ) : lessonLoading ? (
            <p className="text-[15px] text-secondary">Opening your lesson…</p>
          ) : (
            <div className="flex flex-col gap-5">
              <h1 className="text-[34px] font-bold tracking-tight">Today&rsquo;s lesson</h1>
              <StepNotice reason="model-transient" onRetry={() => void loadLesson()} />
            </div>
          ))}

        {view.step === "drills" && <DrillsStep lesson={lesson} onDone={() => void finishStep("drills")} />}

        {view.step === "letter" && <LetterStep onDone={() => void finishStep("letter")} />}

        {view.step === "conversation" && (
          <ConversationStep met={view.conversationMet} onDone={() => void finishStep("conversation")} />
        )}

        {view.step === null && (
          <div data-session-done className="flex flex-col items-center gap-5 text-center">
            <h1 className="text-[34px] font-bold tracking-tight">Done for today</h1>
            <p className="text-[17px] leading-[1.47] text-secondary">
              {figures ? completionSentence(figures) : "Today's session is finished."}
            </p>
            <Link
              href="/practice"
              className="rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
            >
              Back to today
            </Link>
          </div>
        )}
      </motion.main>
    </div>
  );
}
