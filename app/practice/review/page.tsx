"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { Flashcard } from "@/components/flashcard";
import { GRADES, gradeForKey, type CardView, type Grade } from "@/lib/cards-view";

// The full-screen practice session (E-5). It fetches the due queue once as a
// snapshot and walks it one card at a time: space (or a click) flips the card
// with the 3D flip, keys 1–4 grade Again/Hard/Good/Easy — which persists the SM-2
// update and advances to the next card — and when the queue is exhausted a quiet
// done state closes it. Everything is keyboard-drivable; `data-*` on the root lets
// an e2e follow flip → grade → advance → done.

type Phase = "loading" | "active" | "done";

export default function PracticeReviewPage() {
  const reduced = usePrefersReducedMotion();
  const [cards, setCards] = useState<CardView[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [grading, setGrading] = useState(false);
  const [phase, setPhase] = useState<Phase>("loading");

  useEffect(() => {
    let alive = true;
    fetch("/api/cards?due=1")
      .then((r) => r.json())
      .then((body: { cards: CardView[] }) => {
        if (!alive) return;
        setCards(body.cards);
        setPhase(body.cards.length === 0 ? "done" : "active");
      })
      .catch(() => alive && setPhase("done"));
    return () => {
      alive = false;
    };
  }, []);

  const current = cards[index];

  const grade = useCallback(
    async (g: Grade) => {
      if (!current || grading) return;
      setGrading(true);
      try {
        await fetch(`/api/cards/${current.id}/grade`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grade: g }),
        });
      } catch {
        // A transient failure shouldn't strand the session; move on regardless.
      } finally {
        setFlipped(false);
        setGrading(false);
        setIndex((i) => i + 1);
      }
    },
    [current, grading],
  );

  // The queue is a fixed snapshot; once the cursor walks past its end the session
  // is done. Kept out of the grade handler so no setState nests inside another.
  useEffect(() => {
    if (phase === "active" && cards.length > 0 && index >= cards.length) setPhase("done");
  }, [phase, index, cards.length]);

  // One window-level key handler: space flips, 1–4 grade (only once flipped, so a
  // grade always follows seeing the answer). preventDefault stops space scrolling.
  useEffect(() => {
    if (phase !== "active") return;
    function onKey(e: KeyboardEvent) {
      if (e.code === "Space") {
        e.preventDefault();
        setFlipped((f) => !f);
        return;
      }
      if (flipped && !grading) {
        const g = gradeForKey(e.key);
        if (g) {
          e.preventDefault();
          void grade(g);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, flipped, grading, grade]);

  return (
    <div
      data-review
      data-review-phase={phase}
      data-card-index={index}
      data-remaining={Math.max(0, cards.length - index)}
      className="flex min-h-screen flex-col p-6"
    >
      <header className="flex items-center justify-between">
        <Link
          href="/practice"
          data-exit-review
          aria-label="End session"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[15px] text-secondary transition-transform hover:text-ink active:scale-[0.98]"
        >
          <X size={20} strokeWidth={1.5} aria-hidden />
          End session
        </Link>
        {phase === "active" && (
          <span className="tabular text-[15px] text-secondary">
            {index + 1} / {cards.length}
          </span>
        )}
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-8">
        {phase === "loading" && <p className="text-[15px] text-secondary">Loading the due queue…</p>}

        {phase === "done" && <DoneState reduced={reduced} reviewed={Math.min(index, cards.length)} />}

        {phase === "active" && current && (
          <>
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              aria-label={flipped ? "Show the phrase" : "Show the correction"}
              className="w-full max-w-xl focus-visible:outline-none"
            >
              <Flashcard
                front={current.front}
                back={current.back}
                category={current.category}
                flipped={flipped}
              />
            </button>

            <div data-grades className="flex flex-wrap items-center justify-center gap-2">
              {GRADES.map(({ grade: g, label, key }) => (
                <button
                  key={g}
                  type="button"
                  data-grade={g}
                  disabled={!flipped || grading}
                  onClick={() => void grade(g)}
                  className="flex items-center gap-2 rounded-full bg-card px-4 py-2.5 text-[15px] font-medium text-ink shadow-card transition-transform active:translate-y-px active:scale-[0.97] disabled:opacity-40"
                >
                  {label}
                  <span className="tabular text-[13px] text-secondary">{key}</span>
                </button>
              ))}
            </div>

            <p className="text-[13px] text-secondary">
              {flipped ? "Grade how well you recalled it — keys 1–4." : "Space to reveal the correction."}
            </p>
          </>
        )}
      </main>
    </div>
  );
}

/**
 * The finished state says what just happened (RETRO-001): a walked queue gets a
 * recap of how many cards were reviewed; arriving with nothing due gets the
 * quiet fact. Both offer the way back — a finished session never just vanishes.
 */
function DoneState({ reduced, reviewed }: { reduced: boolean; reviewed: number }) {
  return (
    <motion.div
      data-review-done
      data-reviewed={reviewed}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={reduced ? { duration: 0.2 } : SPRING}
      className="flex max-w-md flex-col items-center gap-4 text-center"
    >
      <h1 className="text-[34px] font-bold tracking-tight">
        {reviewed > 0 ? "Queue cleared" : "Nothing due"}
      </h1>
      <p className="tabular text-[17px] text-secondary">
        {reviewed > 0
          ? `You reviewed ${reviewed} ${reviewed === 1 ? "card" : "cards"}. Nothing more is due right now — cards return when their next review comes around.`
          : "Nothing is due right now. Cards return when their next review comes around."}
      </p>
      <Link
        href="/practice"
        className="inline-block rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
      >
        Back to practice
      </Link>
    </motion.div>
  );
}
