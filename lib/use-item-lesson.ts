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
  | { phase: "error"; message: string }
  | { phase: "ready"; lesson: ItemLesson };

export function useItemLesson(itemId: string) {
  const [state, setState] = useState<ItemLessonState>({ phase: "loading" });

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
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({ phase: "error", message: body.error ?? "This lesson could not be loaded." });
        return;
      }
      const body = (await res.json()) as { lesson: ItemLesson };
      setState({ phase: "ready", lesson: body.lesson });
    })().catch(() => {
      if (alive) setState({ phase: "error", message: "This lesson could not be loaded." });
    });
    return () => {
      alive = false;
    };
  }, [itemId]);

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

  return { state, complete };
}
