"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollAction } from "./poll";
import { isInFlight, sessionPhase, type SessionListItem } from "./sessions-list-view";

// THE HOME FOLLOWS THE RECORDING (E-42 criterion 4).
//
// `app/page.tsx` used to call `load()` exactly twice — once on mount and once after
// an upload — so a learner who recorded something watched a row that said "Not
// analyzed yet" until they reloaded the page by hand. With analysis now automatic,
// that would have been worse still: the whole pipeline would run to completion
// behind a screen that never changed.
//
// This mirrors lib/use-ingest.ts and lib/use-analysis.ts exactly — same loop, same
// `alive` guard, same `pollCount` so a test can prove polling truly STOPS — and
// shares their one authority on what an HTTP status means, `pollAction` (lib/poll.ts):
// 404/410 is a final answer and stops the loop, everything else non-OK is transient
// (E-16 criterion 6). It polls the LIST rather than instantiating the two per-session
// hooks per row, because N rows × 2 hooks would be 2N requests a second on the home
// screen; `listSessionItems` answers all of it in a fixed number of queries.
//
// And it stops when there is nothing left to watch: the moment every session is
// settled, the timer is not rescheduled. A finished screen makes no requests.

const POLL_MS = Number(process.env.NEXT_PUBLIC_SESSIONS_POLL_MS ?? 1500);

/** Is anything still expected to move by itself? */
export function anyInFlight(sessions: readonly SessionListItem[]): boolean {
  return sessions.some((s) => isInFlight(sessionPhase(s)));
}

export interface SessionsPoll {
  /** null until the first fetch resolves — "loading", distinct from "empty". */
  sessions: SessionListItem[] | null;
  /** Whether the hook is still polling (false once everything is settled). */
  polling: boolean;
  /** How many fetches have completed — lets a test prove polling truly stops. */
  pollCount: number;
  /** Re-fetch now and resume polling; call right after an upload lands. */
  refresh: () => void;
}

export function useSessions(): SessionsPoll {
  const [sessions, setSessions] = useState<SessionListItem[] | null>(null);
  const [polling, setPolling] = useState(true);
  const [pollCount, setPollCount] = useState(0);
  const [nonce, setNonce] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setPolling(true);

    async function tick() {
      let next: SessionListItem[] | null = null;
      try {
        const res = await fetch("/api/sessions");
        const action = pollAction(res.status);
        if (action === "stop") {
          setPolling(false);
          return;
        }
        if (action === "use") next = (await res.json()) as SessionListItem[];
      } catch {
        next = null; // transient failure — try again on the next tick
      }
      if (!alive) return;
      if (next) {
        setSessions(next);
        setPollCount((n) => n + 1);
        if (!anyInFlight(next)) {
          setPolling(false);
          return; // everything is settled: do not schedule another fetch
        }
      }
      timer.current = setTimeout(tick, POLL_MS);
    }

    void tick();
    return () => {
      alive = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { sessions, polling, pollCount, refresh };
}
