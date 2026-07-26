"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { Flashcard } from "@/components/flashcard";
import { StepNotice } from "./step-notice";
import { GRADES, type CardView, type Grade } from "@/lib/cards-view";
import { DrillCard } from "@/components/drill-card";
import {
  drillProgress,
  drillSpeechOffered,
  initialDrillProgress,
  type DrillAction,
  type DrillOutcome,
} from "@/lib/lessons/drill-progress";
import type { SessionLessonBody } from "@/lib/session/lesson-body";

// Step two: the drills (E-44). The day's exercises for the rule just taught, then
// every card due — one linear queue, no choices, no menu to return to.
//
// D-27's overlay lands here: the exercises come from the SYLLABUS item (they exist on
// a day with nothing recorded), and the cards come from the learner's OWN recordings —
// FSRS-due reviews first, then fresh cards minted from findings they have never
// drilled. That last part is how the composer's `finding` plan items reach the learner
// (criterion 9): an unspent finding IS a fresh card, and a fresh card is right here.
//
// D-18 is intact: an exercise cue is meaning-first and a card front is the E-29
// correction-forward front. The learner's own error is never the stimulus.
//
// A grade that fails to save is SAID SO and retried, not swallowed. The old review
// screen advanced regardless — "a transient failure shouldn't strand the session" —
// which silently lost the review and, with it, the drills step's own completion bar.

type Phase = "loading" | "exercises" | "cards" | "empty";

// [E-45] The placeholder exercise card is gone. E-44 wrote one that was multiple
// choice only, with "Show the answer" for a typed cloze, and said in its own comment
// that click-or-voice was E-45's to bring — this is that. `DrillCard` is the one
// drill surface: options always present, speech offered when the drill invites it,
// and a dispute window before anything is recorded.

export function DrillsStep({ lesson, onDone }: { lesson: SessionLessonBody | null; onDone: () => void }) {
  const reduced = usePrefersReducedMotion();
  const exercises = lesson?.lesson?.exercises ?? [];
  const [cards, setCards] = useState<CardView[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState(initialDrillProgress);
  const exIndex = progress.index;
  const exResolved = progress.pending !== null;
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [failedGrade, setFailedGrade] = useState<Grade | null>(null);
  const [grading, setGrading] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/cards?due=1")
      .then((r) => r.json())
      .then((body: { cards: CardView[] }) => {
        if (!alive) return;
        setCards(body.cards);
        setPhase(exercises.length > 0 ? "exercises" : body.cards.length > 0 ? "cards" : "empty");
      })
      .catch(() => {
        if (!alive) return;
        setPhase(exercises.length > 0 ? "exercises" : "empty");
      });
    return () => {
      alive = false;
    };
  }, [exercises.length]);

  // [E-45] RESOLVING RECORDS NOTHING. This used to POST cued evidence the instant
  // the drill resolved, which for a spoken answer meant the moment speech-to-text
  // disagreed — before the learner could say "that's not what I said". `evidence`
  // is append-only with RAISE(ABORT) triggers, so that row was permanent and one
  // bad transcript demoted a lemma the learner actually knew (D-19).
  //
  // The sequence now runs through the shared pure reducer, which both this step and
  // the standalone runner use, so the rule cannot drift into two dialects.
  const dispatch = useCallback(
    (action: DrillAction) => {
      setProgress((current) => {
        const [next, effect] = drillProgress(current, action);
        if (effect.write !== null && lesson) {
          void fetch("/api/lessons/item/complete", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ itemId: lesson.itemId, correct: effect.write }),
          }).catch(() => {});
        }
        return next;
      });
    },
    [lesson],
  );

  const resolveExercise = useCallback(
    (outcome: DrillOutcome) => dispatch({ type: "resolve", outcome }),
    [dispatch],
  );

  const nextExercise = useCallback(() => {
    dispatch({ type: "advance", total: exercises.length });
    if (exIndex + 1 < exercises.length) return;
    // Exercises done. Cards next if there are any; otherwise the step is finished —
    // the learner did the work, so the step completes rather than showing an empty
    // state to someone who is not looking at one.
    if (cards.length > 0) setPhase("cards");
    else onDone();
  }, [dispatch, exIndex, exercises.length, cards.length, onDone]);

  const grade = useCallback(
    async (g: Grade) => {
      const card = cards[cardIndex];
      if (!card || grading) return;
      setGrading(true);
      setFailedGrade(null);
      try {
        const res = await fetch(`/api/cards/${card.id}/grade`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ grade: g }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setFlipped(false);
        setCardIndex((i) => i + 1);
      } catch {
        // Say so and stay put. Advancing on a failed save loses the review AND the
        // step's completion bar, and tells the learner nothing. The grade is kept so
        // the retry re-sends the SAME answer rather than asking for it again.
        setFailedGrade(g);
      } finally {
        setGrading(false);
      }
    },
    [cards, cardIndex, grading],
  );

  // The queue is walked: the step is finished, so finish it. Showing a "nothing due"
  // screen to someone who just cleared the queue would be a false statement.
  useEffect(() => {
    if (phase === "cards" && cards.length > 0 && cardIndex >= cards.length) onDone();
  }, [phase, cardIndex, cards.length, onDone]);

  if (phase === "loading") {
    return <p className="text-[15px] text-secondary">Gathering today&rsquo;s drills…</p>;
  }

  if (phase === "exercises") {
    const exercise = exercises[exIndex];
    return (
      <div data-step-drills data-drill-phase="exercises" className="flex flex-col gap-5">
        <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          Exercise <span className="tabular">{exIndex + 1}</span> of{" "}
          <span className="tabular">{exercises.length}</span>
        </span>
        <motion.div
          key={exIndex}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0.2 } : SPRING}
          data-exercise
          className="rounded-card bg-card p-5 shadow-card"
        >
          <DrillCard
            key={exIndex}
            exercise={exercise}
            speechOffered={drillSpeechOffered(progress)}
            onResolve={resolveExercise}
          />
        </motion.div>
        <button
          type="button"
          data-drill-next
          disabled={!exResolved}
          onClick={nextExercise}
          className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {exIndex + 1 < exercises.length ? "Next" : cards.length > 0 ? "On to your cards" : "Continue"}
        </button>
      </div>
    );
  }

  if (phase === "cards") {
    const card = cards[cardIndex];
    return (
      <div data-step-drills data-drill-phase="cards" className="flex flex-col items-center gap-6">
        <span className="tabular self-start text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          Card {cardIndex + 1} of {cards.length}
        </span>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setFlipped((f) => !f)}
          onKeyDown={(e) => e.key === "Enter" && setFlipped((f) => !f)}
          aria-label={flipped ? "Show the phrase" : "Show the correction"}
          className="w-full cursor-pointer focus-visible:outline-none"
        >
          <Flashcard
            front={card.front}
            correction={card.correction}
            why={card.why}
            error={card.error}
            category={card.category}
            flipped={flipped}
            findingId={card.findingId}
          />
        </div>
        {failedGrade && (
          <div className="w-full">
            <StepNotice reason="save-failed" onRetry={() => void grade(failedGrade)} />
          </div>
        )}
        <div data-grades className="flex flex-wrap items-center justify-center gap-2">
          {GRADES.map(({ grade: g, label }) => (
            <button
              key={g}
              type="button"
              data-grade={g}
              disabled={!flipped || grading}
              onClick={() => void grade(g)}
              className="rounded-full bg-card px-4 py-2.5 text-[15px] font-medium text-ink shadow-card transition-transform active:translate-y-px active:scale-[0.97] disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-secondary">
          {flipped ? "How well did you recall it?" : "Tap the card to see the correction."}
        </p>
      </div>
    );
  }

  return (
    <div data-step-drills data-drill-phase="empty" className="flex flex-col gap-5">
      <h1 className="text-[34px] font-bold tracking-tight">Drills</h1>
      <StepNotice reason="no-cards" />
      <button
        type="button"
        data-step-continue
        onClick={onDone}
        className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
      >
        Continue
      </button>
    </div>
  );
}
