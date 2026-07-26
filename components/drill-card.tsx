"use client";

import { useState } from "react";
import { Mic, Square } from "lucide-react";
import { gradeItemExercise, type ItemExercise } from "@/lib/lessons/item-lessons-view";
import { MISHEARD_STREAK_TO_FALL_BACK } from "@/lib/lessons/spoken-answer";
import { useRecorder } from "@/lib/use-recorder";

// ONE drill, answered by tapping or by speaking (E-45 criterion 2). There is no
// text field: typing left the daily flow with the `fill_in` and `rewrite` exercises
// it belonged to.
//
// ── THE MISHEARING PATH ──────────────────────────────────────────────────────
//
// This product's learner is an advanced speaker with an accent, and marking their
// correct answer wrong is the most corrosive thing a language app can do to them.
// Speech recognition WILL mishear them. So the design does not pretend otherwise:
//
//   1. the transcript is SHOWN. "I heard: il problema" is a fact the learner can
//      judge; a bare "Not quite" is an accusation they cannot argue with;
//   2. a wrong verdict on a SPOKEN answer offers one control — "That's not what I
//      said" — and taking it marks the drill correct. The learner is the authority
//      on what came out of their own mouth, and we are not;
//   3. NOTHING IS RECORDED WHILE THE VERDICT IS ON SCREEN. Resolving a drill only
//      opens the dispute window; the evidence write happens when the learner leaves
//      the drill (components/lesson-runner.tsx `advance`, lib/lessons/drill-session.ts).
//      That ordering is the whole guarantee: `evidence` is append-only with
//      RAISE(ABORT) triggers, so a row written before the learner could object would
//      be permanent. A disputed drill writes nothing in either direction;
//   4. after MISHEARD_STREAK_TO_FALL_BACK overrides in a row the runner stops
//      offering speech for the rest of the session and says so once. Three in a row
//      is not bad luck, it is recognition not working for this voice today, and
//      continuing to offer it is asking someone to keep failing at something we
//      already know is broken.
//
// And underneath all of it: every drill has options, so tapping is always there.
// No microphone, denied permission, no API key, budget spent, network down — each
// falls back to the same working control rather than to a wall (D-26).

export type DrillOutcome = "correct" | "incorrect" | "misheard";

/** A recorded take as the transcription route wants it. Browser-only. */
async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

interface Props {
  exercise: ItemExercise;
  /** Speech is offered only when the drill invites it AND the session has not
   *  fallen back after too many mishearings. */
  speechOffered: boolean;
  onResolve: (outcome: DrillOutcome) => void;
}

/** Correction-forward feedback: verdict, then the correct form + why (D-18). */
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

/** The meaning-first cue, with an Italian definition when one is attached. */
function Cue({ exercise }: { exercise: ItemExercise }) {
  return (
    <div className="flex flex-col gap-1.5">
      {exercise.definition ? (
        <p data-definition className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {exercise.definition}
        </p>
      ) : null}
      <p className="text-[17px] leading-[1.47] text-ink">{exercise.prompt}</p>
    </div>
  );
}

export function DrillCard({ exercise, speechOffered, onResolve }: Props) {
  const recorder = useRecorder();
  const [picked, setPicked] = useState<number | null>(null);
  const [heard, setHeard] = useState<string | null>(null);
  const [spokenCorrect, setSpokenCorrect] = useState<boolean | null>(null);
  const [overridden, setOverridden] = useState(false);
  const [busy, setBusy] = useState(false);

  const resolved = picked !== null || spokenCorrect !== null;
  const correct = overridden || (picked !== null ? picked === exercise.answerIndex : spokenCorrect === true);
  const speak = speechOffered && exercise.invite === "speak";

  function choose(i: number) {
    if (resolved) return;
    setPicked(i);
    onResolve(gradeItemExercise(exercise, i) ? "correct" : "incorrect");
  }

  async function say() {
    if (resolved || busy) return;
    if (recorder.status === "recording") {
      setBusy(true);
      try {
        const take = await recorder.stop();
        // A take we could not capture is not a wrong answer: say nothing, let them
        // tap. Silence here is the difference between "we failed" and "you failed".
        if (!take) return;
        const res = await fetch("/api/lessons/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audioBase64: await blobToBase64(take.blob),
            format: take.extension,
            seconds: take.durationMs / 1000,
            drillKey: exercise.answer,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as { heard?: string | null };
        if (!body.heard) return; // unavailable / budget / empty — the tap path stands
        const ok = gradeItemExercise(exercise, body.heard);
        setHeard(body.heard);
        setSpokenCorrect(ok);
        onResolve(ok ? "correct" : "incorrect");
      } finally {
        setBusy(false);
      }
      return;
    }
    await recorder.start();
  }

  function notWhatISaid() {
    setOverridden(true);
    onResolve("misheard");
  }

  return (
    <div className="flex flex-col gap-3">
      <Cue exercise={exercise} />

      {speak && !resolved ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-drill-speak
            disabled={busy}
            onClick={() => void say()}
            className="inline-flex items-center gap-2 self-start rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {recorder.status === "recording" ? (
              <>
                <Square size={20} strokeWidth={1.5} aria-hidden /> Stop
              </>
            ) : (
              <>
                <Mic size={20} strokeWidth={1.5} aria-hidden /> Say it
              </>
            )}
          </button>
          <span className="text-[13px] text-secondary">Say the answer, or tap one below.</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {exercise.options.map((option, i) => {
          const isAnswer = i === exercise.answerIndex;
          const isPicked = picked === i;
          const tone = resolved
            ? isAnswer
              ? "border-good bg-good/[0.12] text-ink"
              : isPicked
                ? "border-severe bg-severe/[0.12] text-ink"
                : "border-hairline text-secondary"
            : "border-hairline text-ink hover:border-ink";
          return (
            <button
              key={option}
              type="button"
              data-option
              data-correct={resolved && isAnswer ? "true" : undefined}
              disabled={resolved}
              onClick={() => choose(i)}
              className={`rounded-control border px-4 py-2.5 text-left text-[15px] transition-colors active:scale-[0.99] disabled:cursor-default ${tone}`}
            >
              {option}
            </button>
          );
        })}
      </div>

      {heard !== null && (
        <p data-heard className="text-[13px] text-secondary">
          I heard: <span className="text-ink">{heard}</span>
        </p>
      )}

      {resolved ? <Feedback exercise={exercise} correct={correct} /> : null}

      {/* The learner's last word, and it is available for as long as the verdict
          is. Offered only when a SPOKEN answer was judged wrong — after a tap there
          is nothing to dispute, because nothing was transcribed. */}
      {spokenCorrect === false && !overridden && (
        <button
          type="button"
          data-not-what-i-said
          onClick={notWhatISaid}
          className="self-start rounded-full bg-page px-4 py-2 text-[13px] font-medium text-ink transition-transform active:scale-[0.97]"
        >
          That&apos;s not what I said
        </button>
      )}
      {overridden && (
        <p data-overridden className="text-[13px] text-secondary">
          Taken as correct. Nothing is recorded for this one, either way.
        </p>
      )}
      {/* True while the window is open, and it is the reason the button above is
          worth pressing: the learner is told the verdict is not yet a record. */}
      {spokenCorrect === false && !overridden && (
        <p data-dispute-window className="text-[13px] text-secondary">
          Nothing is recorded until you continue.
        </p>
      )}
    </div>
  );
}

export { MISHEARD_STREAK_TO_FALL_BACK };
