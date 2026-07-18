"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollAction } from "./poll";
import type { AnalysisView } from "./analysis-view";

// Client polling for the analysis report (E-4 part 2 criterion 2), mirroring
// lib/use-ingest.ts. While a run is `queued`/`processing` the hook re-fetches on
// an interval so the detail page advances the progress orb without a manual
// reload; the moment the run reaches a terminal state (done/failed/halted) — or
// there is no run yet (idle) — it renders that and stops polling. The interval is
// cleared on unmount and on the terminal transition; no fetch outlives the job.
// `refresh()` restarts the loop after the user starts a run so the orb picks it up.

const POLL_MS = Number(process.env.NEXT_PUBLIC_ANALYSIS_POLL_MS ?? 1000);

function isTerminal(state: AnalysisView["state"]): boolean {
  return state === "done" || state === "failed" || state === "halted" || state === "idle";
}

export interface AnalysisPoll {
  view: AnalysisView | null;
  /** Whether the hook is still polling (false once terminal/idle or unmounted). */
  polling: boolean;
  /** How many fetches have completed — lets a test prove polling truly stops. */
  pollCount: number;
  /** Re-fetch now and resume polling; call right after starting a run. */
  refresh: () => void;
}

export function useAnalysis(id: string): AnalysisPoll {
  const [view, setView] = useState<AnalysisView | null>(null);
  const [polling, setPolling] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setPolling(true);
    setPollCount(0);

    async function tick() {
      let next: AnalysisView | null = null;
      try {
        const res = await fetch(`/api/sessions/${id}/analysis`);
        const action = pollAction(res.status);
        // A deleted session is a final answer, not a transient failure — stop
        // rather than polling a 404 once a second for the life of the tab.
        if (action === "stop") {
          setPolling(false);
          return;
        }
        if (action === "use") next = (await res.json()) as AnalysisView;
      } catch {
        next = null; // transient failure — try again on the next tick
      }
      if (!alive) return;
      if (next) {
        setView(next);
        setPollCount((n) => n + 1);
        if (isTerminal(next.state)) {
          setPolling(false);
          return; // terminal/idle: do not schedule another fetch
        }
      }
      timer.current = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { view, polling, pollCount, refresh };
}
