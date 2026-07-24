"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Loader2, ArrowUpRight } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatEstimate } from "@/lib/format";

// Ask Erika (E-23, the v0.3 finale): ask any finding for a deeper note. Erika
// returns a persisted explanation that ties this correction to at least one OTHER
// correction from your own history — cited by id and jump-navigable. The note is
// generated once and cached forever; before it exists the button states the price
// ("Ask — est. $X"), after it exists it shows the note immediately.
//
// DESIGN.md: the control is the ink accent (black in light, white in dark). No
// green — a note that exists is a quiet fact, not a win; the only tones a mistake
// earns are red/orange (severity), which live elsewhere. Copy is quiet and specific.

interface Cite {
  id: string;
  quote: string;
  correction: string;
}

interface Status {
  exists: boolean;
  canAsk?: boolean;
  estimateUsd?: number;
  note?: string;
  cited?: Cite[];
}

type Phase = "loading" | "missing" | "unavailable" | "asking" | "note" | "budget" | "error";

/** Jump to a cited finding elsewhere on the page (its `data-entry-id`) and flash it. */
function defaultNavigate(findingId: string) {
  if (typeof document === "undefined") return;
  const el = document.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(findingId)}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.setAttribute("data-cite-flash", "true");
  window.setTimeout(() => el.removeAttribute("data-cite-flash"), 1600);
}

export function AskErika({
  findingId,
  onNavigate = defaultNavigate,
}: {
  findingId: string;
  onNavigate?: (findingId: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ask/${findingId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status failed"))))
      .then((s: Status) => {
        if (!alive) return;
        setStatus(s);
        setPhase(s.exists ? "note" : s.canAsk ? "missing" : "unavailable");
      })
      .catch(() => alive && setPhase("error"));
    return () => {
      alive = false;
    };
  }, [findingId]);

  const ask = useCallback(async () => {
    setPhase("asking");
    try {
      const res = await fetch(`/api/ask/${findingId}`, { method: "POST" });
      if (res.status === 402) return setPhase("budget");
      if (!res.ok) return setPhase("error");
      const s: Status = await res.json();
      setStatus(s);
      setPhase("note");
    } catch {
      setPhase("error");
    }
  }, [findingId]);

  if (phase === "loading" || phase === "unavailable") {
    // While loading, or when there is no other finding to cite yet, the control is
    // silent — an ask that could not cite anything is not offered.
    return <div data-ask data-ask-phase={phase} />;
  }

  return (
    <div data-ask data-ask-phase={phase} className="flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
      {phase === "missing" ? (
        <button
          type="button"
          data-ask-generate
          onClick={ask}
          className="inline-flex w-fit items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97]"
        >
          <Sparkles size={16} strokeWidth={1.5} aria-hidden />
          Ask — est. {formatEstimate(status?.estimateUsd ?? 0)}
        </button>
      ) : phase === "asking" ? (
        <span data-ask-asking className="inline-flex items-center gap-1.5 text-[13px] text-secondary">
          <Loader2 size={16} strokeWidth={1.5} aria-hidden className="animate-spin" />
          Erika is writing…
        </span>
      ) : phase === "budget" ? (
        <span data-ask-budget className="text-[13px] text-secondary">
          Monthly budget reached — raise it or wait for the month to roll over.
        </span>
      ) : phase === "error" ? (
        <span data-ask-error className="text-[13px] text-secondary">
          Ask is unavailable right now.
        </span>
      ) : (
        <AnimatePresence initial={false}>
          <motion.div
            key="note"
            data-ask-note
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            transition={reduced ? { duration: 0.15 } : SPRING}
            className="flex flex-col gap-3 rounded-control bg-page p-4"
          >
            <p className="text-[15px] leading-[1.47] text-ink">{status?.note}</p>
            {status?.cited && status.cited.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
                  Related in your history
                </span>
                <div className="flex flex-wrap gap-2">
                  {status.cited.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-ask-cite={c.id}
                      onClick={() => onNavigate(c.id)}
                      className="inline-flex max-w-full items-center gap-1 rounded-full bg-card px-3 py-1 text-[13px] text-accent transition-transform active:scale-[0.97]"
                    >
                      <span className="truncate">“{c.correction}”</span>
                      <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden className="shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  );
}
