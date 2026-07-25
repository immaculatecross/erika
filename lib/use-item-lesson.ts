"use client";

import { useCallback, useEffect, useState } from "react";
import type { ItemLesson } from "@/lib/lessons/item-lessons-view";
import type { KnowledgeStatus } from "@/lib/knowledge/types";

// Client hook driving the E-32 item-lesson runner against the item-lesson routes.
// On mount it POSTs /api/lessons/item/generate — a cached lesson comes back with no
// model call, a first open generates once, and a reached monthly cap answers 402
// which we surface as a truthful `budget` phase, never a broken screen. `complete`
// posts one graded exercise's result (correct/incorrect) to the evidence bridge —
// no model call — so finishing an exercise feeds the knowledge core.

export type ItemLessonState =
  | { phase: "loading" }
  | { phase: "budget" }
  /** [E-39 §B3] `retryable` decides whether the runner may offer "Try again" at all:
   *  offering it for a missing key is the defect (a control that cannot ever succeed),
   *  and NOT offering it for a real blip is the mirror defect. The server says which. */
  | { phase: "error"; message: string; retryable: boolean }
  | { phase: "ready"; lesson: ItemLesson };

export function useItemLesson(itemId: string) {
  const [state, setState] = useState<ItemLessonState>({ phase: "loading" });
  /** Bumped by `retry()` to re-run the effect — the in-place recovery a transient
   *  failure had no way to reach before (the error branch was a heading and a link). */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setState({ phase: "loading" });
    (async () => {
      const res = await fetch("/api/lessons/item/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!alive) return;
      if (res.status === 402) {
        setState({ phase: "budget" });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
        setState({
          phase: "error",
          message: body.error ?? "This lesson could not be loaded.",
          // An unlabelled failure is treated as transient: a retry that fails again is a
          // smaller harm than withholding the only way forward from someone who can use it.
          retryable: body.retryable ?? true,
        });
        return;
      }
      const body = (await res.json()) as { lesson: ItemLesson };
      setState({ phase: "ready", lesson: body.lesson });
    })().catch(() => {
      // A thrown fetch never reached the server, so it is transient by construction.
      if (alive) setState({ phase: "error", message: "This lesson could not be loaded.", retryable: true });
    });
    return () => {
      alive = false;
    };
  }, [itemId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Record one graded exercise's result as cued evidence. Best-effort: a failed
  // write must not break the runner (the lesson content is unaffected), so it
  // resolves to the new status or null.
  const complete = useCallback(
    async (correct: boolean): Promise<KnowledgeStatus | null> => {
      const res = await fetch("/api/lessons/item/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, correct }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { status: KnowledgeStatus };
      return body.status;
    },
    [itemId],
  );

  return { state, complete, retry };
}
