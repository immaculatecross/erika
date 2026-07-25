"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { Flashcard } from "@/components/flashcard";
import { StepNotice } from "./step-notice";
import { GRADES, type CardView, type Grade } from "@/lib/cards-view";
import { gradeItemExercise, type ItemExercise } from "@/lib/lessons/item-lessons-view";
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

function Feedback({ exercise, correct }: { exercise: ItemExercise; correct: boolean }) {
  return (
    <div data-feedback className="flex flex-col gap-1.5">
      <p data-correct={correct} className={`text-[15px] font-medium ${correct ? "text-good" : "text-severe"}`}>
        {correct ? "Correct" : "Not quite"}
      </p>
      <p className="text-[15px] text-ink">
        <span className="text-secondary">Answer: </span>
        <span data-answer className="font-medium">{exercise.answer}</span>
      </p>
      <p className="text-[15px] text-secondary">{exercise.rationale}</p>
    </div>
  );
}

/** One exercise, answered by tapping. Multiple choice only in the session: a typed
 *  cloze is E-45's to replace with click-or-voice, and offering a text box here would
 *  be building the thing that milestone deletes. A cloze is shown with its answer
 *  revealed as a worked example — honest, and still a real beat. */
function ExerciseCard({ exercise, onResolve }: { exercise: ItemExercise; onResolve: (c: boolean) => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const options = exercise.options ?? [];
  const isChoice = exercise.type === "multiple_choice" && options.length > 1;
  const resolved = isChoice ? picked !== null : shown;

  return (
    <div className="flex flex-col gap-3">
      {exercise.gloss && (
        <p data-gloss className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {exercise.gloss}
        </p>
      )}
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>

      {isChoice ? (
        <div className="flex flex-col gap-2">
          {options.map((option, i) => {
            const isAnswer = i === exercise.answerIndex;
            const tone = resolved
              ? isAnswer
                ? "border-good bg-good/[0.12] text-ink"
                : picked === i
                  ? "border-severe bg-severe/[0.12] text-ink"
                  : "border-hairline text-secondary"
              : "border-hairline text-ink hover:border-ink";
            return (
              <button
                key={option}
                type="button"
                data-option
                disabled={resolved}
                onClick={() => {
                  if (resolved) return;
                  setPicked(i);
                  onResolve(gradeItemExercise(exercise, i));
                }}
                className={`rounded-control border px-4 py-3 text-left text-[15px] transition-colors active:scale-[0.99] disabled:cursor-default ${tone}`}
              >
                {option}
              </button>
            );
          })}
        </div>
      ) : (
        !resolved && (
          <button
            type="button"
            data-reveal
            onClick={() => {
              setShown(true);
              onResolve(true);
            }}
            className="self-start rounded-full bg-card px-4 py-2 text-[15px] font-medium text-ink shadow-card transition-transform active:scale-[0.98]"
          >
            Show the answer
          </button>
        )
      )}

      {resolved && <Feedback exercise={exercise} correct={isChoice ? picked === exercise.answerIndex : true} />}
    </div>
  );
}

export function DrillsStep({ lesson, onDone }: { lesson: SessionLessonBody | null; onDone: () => void }) {
  const reduced = usePrefersReducedMotion();
  const exercises = lesson?.lesson?.exercises ?? [];
  const [cards, setCards] = useState<CardView[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [exIndex, setExIndex] = useState(0);
  const [exResolved, setExResolved] = useState(false);
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

  const resolveExercise = useCallback(
    (correct: boolean) => {
      setExResolved(true);
      if (!lesson) return;
      // Cued evidence into the E-25 knowledge core (E-32's door, unchanged).
      void fetch("/api/lessons/item/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: lesson.itemId, correct }),
      }).catch(() => {});
    },
    [lesson],
  );

  const nextExercise = useCallback(() => {
    setExResolved(false);
    if (exIndex + 1 < exercises.length) {
      setExIndex((i) => i + 1);
      return;
    }
    // Exercises done. Cards next if there are any; otherwise the step is finished —
    // the learner did the work, so the step completes rather than showing an empty
    // state to someone who is not looking at one.
    if (cards.length > 0) setPhase("cards");
    else onDone();
  }, [exIndex, exercises.length, cards.length, onDone]);

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
          <ExerciseCard exercise={exercise} onResolve={resolveExercise} />
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
