"use client";

import { useEffect, useRef, useState } from "react";
import { pollAction } from "./poll";
import type { IngestView } from "./ingest-view";

// Client polling for the ingest view (E-3 part 2 criterion 1). While the job is
// queued or processing the hook re-fetches on an interval so the detail page
// advances the stage/progress without a manual reload; the moment the job
// reaches a terminal state (done/failed) it renders the result and stops
// polling. The interval is cleared on unmount and on the terminal transition —
// no fetch outlives the component or the job.

const POLL_MS = Number(process.env.NEXT_PUBLIC_INGEST_POLL_MS ?? 1000);

function isTerminal(state: IngestView["state"]): boolean {
  return state === "done" || state === "failed";
}

export interface IngestPoll {
  view: IngestView | null;
  /** Whether the hook is still polling (false once terminal or unmounted). */
  polling: boolean;
  /** How many fetches have completed — lets a test prove polling truly stops. */
  pollCount: number;
}

export function useIngest(id: string): IngestPoll {
  const [view, setView] = useState<IngestView | null>(null);
  const [polling, setPolling] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setView(null);
    setPolling(true);
    setPollCount(0);

    async function tick() {
      let next: IngestView | null = null;
      try {
        const res = await fetch(`/api/sessions/${id}/ingest`);
        const action = pollAction(res.status);
        // The session is gone (deleted, or a stale URL): that is a final answer,
        // not a hiccup. Stop, or the tab polls a 404 every second forever.
        if (action === "stop") {
          setPolling(false);
          return;
        }
        if (action === "use") next = (await res.json()) as IngestView;
      } catch {
        next = null; // transient failure — try again on the next tick
      }
      if (!alive) return;
      if (next) {
        setView(next);
        setPollCount((n) => n + 1);
        if (isTerminal(next.state)) {
          setPolling(false);
          return; // terminal: do not schedule another fetch
        }
      }
      timer.current = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);

  return { view, polling, pollCount };
}
