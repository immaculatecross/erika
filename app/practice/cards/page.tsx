"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Download } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { type CardBrowserView } from "@/lib/cards-view";

// The card browser (E-5b): every card with its front, back, category, due date,
// and suspended state, plus suspend/unsuspend, a confirm-guarded delete, and an
// Anki CSV export. DESIGN — calm rows, ink accent, red only on the destructive
// delete, tabular numerals for the due date, one signature stagger on entry.

type Phase = "loading" | "ready";

/** SQLite UTC "YYYY-MM-DD HH:MM:SS" → "Due now" (past) or a short future date. */
function dueLabel(due: string): string {
  const d = new Date(`${due.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return due;
  if (d.getTime() <= Date.now()) return "Due now";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function CardBrowserPage() {
  const reduced = usePrefersReducedMotion();
  const [cards, setCards] = useState<CardBrowserView[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [pending, setPending] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cards");
    const body = (await res.json()) as { cards: CardBrowserView[] };
    setCards(body.cards);
    setPhase("ready");
  }, []);

  useEffect(() => {
    load().catch(() => setPhase("ready"));
  }, [load]);

  async function toggleSuspend(card: CardBrowserView) {
    setPending(card.id);
    try {
      await fetch(`/api/cards/${card.id}/suspend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suspended: !card.suspended }),
      });
      setCards((cs) => cs.map((c) => (c.id === card.id ? { ...c, suspended: !c.suspended } : c)));
    } finally {
      setPending(null);
    }
  }

  async function remove(id: string) {
    setPending(id);
    try {
      await fetch(`/api/cards/${id}`, { method: "DELETE" });
      setCards((cs) => cs.filter((c) => c.id !== id));
    } finally {
      setConfirming(null);
      setPending(null);
    }
  }

  if (phase === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Loading your cards…</p>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <div data-cards-empty className="flex max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-[34px] font-bold tracking-tight">Cards</h1>
          <p className="text-[17px] text-secondary">
            No cards yet. They arrive once Erika has heard you speak and found something to work on.
          </p>
          <Link
            href="/practice"
            className="inline-block rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Back to practice
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between gap-4">
        <Link href="/practice" className="inline-flex items-center gap-1.5 text-[15px] text-secondary hover:text-ink">
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Practice
        </Link>
        <a
          href="/api/cards/export"
          download
          data-export
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          <Download size={20} strokeWidth={1.5} aria-hidden />
          Export CSV
        </a>
      </div>

      <h1 className="mb-6 text-[34px] font-bold tracking-tight">Cards</h1>

      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-cards
        className="flex flex-col gap-3"
      >
        {cards.map((card) => {
          const busy = pending === card.id;
          return (
            <motion.li
              key={card.id}
              variants={staggerItem(reduced)}
              data-card
              data-suspended={card.suspended}
              className={`flex flex-col gap-3 rounded-card bg-card p-5 shadow-card ${card.suspended ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
                  {card.category}
                </span>
                <span className="tabular text-[13px] text-secondary">
                  {card.suspended ? "Suspended" : dueLabel(card.due)}
                </span>
              </div>
              {/* Correction-forward (E-29): the meaning-first cue leads, the
                  correct form is the answer, and the error shows once, marked. */}
              <p className="text-[17px] font-semibold leading-tight text-ink">{card.front}</p>
              <p className="text-[15px] leading-[1.47] text-secondary">
                “{card.correction}”{card.why ? ` — ${card.why}` : ""}
              </p>
              <p className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
                  you said
                </span>
                <span
                  data-card-error
                  className="text-[13px] text-severe line-through decoration-severe/60"
                >
                  “{card.error}”
                </span>
              </p>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  data-suspend
                  disabled={busy}
                  onClick={() => void toggleSuspend(card)}
                  className="rounded-full bg-page px-3.5 py-1.5 text-[13px] font-medium text-ink transition-transform active:scale-[0.97] disabled:opacity-40"
                >
                  {card.suspended ? "Unsuspend" : "Suspend"}
                </button>

                {confirming === card.id ? (
                  <>
                    <button
                      type="button"
                      data-confirm-delete
                      disabled={busy}
                      onClick={() => void remove(card.id)}
                      className="rounded-full bg-severe/[0.12] px-3.5 py-1.5 text-[13px] font-medium text-severe transition-transform active:scale-[0.97] disabled:opacity-40"
                    >
                      {busy ? "Deleting…" : "Confirm delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-secondary transition-transform active:scale-[0.97] hover:text-ink"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-delete
                    onClick={() => setConfirming(card.id)}
                    className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-severe transition-transform active:scale-[0.97] hover:bg-severe/[0.12]"
                  >
                    Delete
                  </button>
                )}
              </div>
            </motion.li>
          );
        })}
      </motion.ul>
    </div>
  );
}
