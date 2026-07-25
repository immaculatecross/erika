"use client";

import { useCallback, useEffect, useState } from "react";
import type { ItemLesson } from "@/lib/lessons/item-lessons-view";
import type { KnowledgeStatus } from "@/lib/knowledge/types";

// Client hook driving the lesson runner against the item-lesson routes. On mount it
// POSTs /api/lessons/item/generate, which answers with `todaysLesson` — the cached
// lesson, else a generated one, else the deterministic syllabus lesson. It cannot
// come back empty, so the hook has no budget branch and no retry control. `complete`
// posts one graded exercise's result (correct/incorrect) to the evidence bridge —
// no model call — so finishing an exercise feeds the knowledge core.

// [E-45] The `budget` phase is GONE. It rendered "Monthly budget reached" as a
// terminal screen for a lesson the learner could always have had for free: the
// syllabus lesson needs no key, no budget and no network (D-27). A refusal that has
// a working alternative is not a refusal, it is a routing decision, and it belongs
// on the server where the alternative lives — not on a wall (D-26).
export type ItemLessonState =
  | { phase: "loading" }
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
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState({
          phase: "error",
          message: body.error ?? "There is no lesson format for this item — it is practised elsewhere.",
        });
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
  //
  // [E-45] The evidence goes to the lesson's OWN `itemId`, not to the one in the
  // URL, and the difference is real: 48 of the 266 syllabus rules illustrate
  // themselves with word lists and cannot make a fair drill, so the engine may
  // teach a neighbouring rule from the same CEFR band instead of walling. When it
  // does, the learner earned that evidence on the rule they were actually shown —
  // writing it against the rule we could not teach would quietly corrupt the
  // knowledge model, which is worse than the 404 it replaced.
  const servedItemId = state.phase === "ready" ? state.lesson.itemId : itemId;
  const complete = useCallback(
    async (correct: boolean): Promise<KnowledgeStatus | null> => {
      const res = await fetch("/api/lessons/item/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: servedItemId, correct }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { status: KnowledgeStatus };
      return body.status;
    },
    [servedItemId],
  );

  return { state, complete };
}
