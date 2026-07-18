"use client";

import { useCallback, useEffect, useState } from "react";
import type { Lesson, LessonGrade } from "@/lib/lessons/lessons-view";

// Client hook that drives the lesson runner's data flow against the existing E-6
// engine routes (no engine change). On mount it POSTs /api/lessons/generate — a
// cached lesson comes back with no model call, a first open generates once, and a
// reached monthly cap answers 402 which we surface as a truthful `budget` phase
// rather than a broken screen. `grade` and `complete` wrap the other two routes.

export type LessonState =
  | { phase: "loading" }
  | { phase: "budget" }
  | { phase: "error"; message: string }
  | { phase: "ready"; lesson: Lesson };

/** A grade attempt resolves to a verdict, the budget cap, or a truthful failure. */
export type GradeOutcome = LessonGrade | { budget: true } | { error: string };

export function useLesson(patternKey: string) {
  const [state, setState] = useState<LessonState>({ phase: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    (async () => {
      const res = await fetch("/api/lessons/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patternKey }),
      });
      if (!alive) return;
      if (res.status === 402) {
        setState({ phase: "budget" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ phase: "error", message: body.error ?? "This lesson could not be loaded." });
        return;
      }
      const body = (await res.json()) as { lesson: Lesson };
      setState({ phase: "ready", lesson: body.lesson });
    })().catch(() => {
      if (alive) setState({ phase: "error", message: "This lesson could not be loaded." });
    });
    return () => {
      alive = false;
    };
  }, [patternKey]);

  const grade = useCallback(
    async (target: string, rewrite: string): Promise<GradeOutcome> => {
      const res = await fetch("/api/lessons/grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patternKey, target, rewrite }),
      });
      if (res.status === 402) return { budget: true };
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { error: body.error ?? "This rewrite could not be graded." };
      }
      return (await res.json()) as LessonGrade;
    },
    [patternKey],
  );

  const complete = useCallback(
    async (score: number): Promise<number | null> => {
      const res = await fetch("/api/lessons/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patternKey, score }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { mastery: number };
      return body.mastery;
    },
    [patternKey],
  );

  return { state, grade, complete };
}
