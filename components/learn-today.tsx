import Link from "next/link";
import { GoalRing } from "./goal-ring";
import { StreakLine } from "./streak-line";
import { threadSentence } from "./today-thread";
import { completionSentence } from "@/lib/session/steps";
import type { TodayView } from "@/lib/today";

// The Learn home, rendered (E-44 criterion 1, D-24 / DESIGN "The daily ritual").
//
// ONE SCREEN, ONE ACTION. In the main column there is the ring, one factual line, the
// streak line, and exactly ONE tappable thing — the primary control, which disappears
// entirely once the day is done. `tests/learn-today-render.test.tsx` counts the
// interactive elements in this markup, so a second row cannot be added back without a
// test going red.
//
// PURE AND PROP-DRIVEN on purpose: no fetch, no effect, no router. The old home was a
// client component with its data-fetching inline, which is exactly why 335 lines of
// product decisions had no unit coverage at all and its thirteen dead-end rows shipped
// past every gate. Everything the learner sees is in here; the page is the wire.
//
// What is deliberately NOT here, and must not come back: the review row, the tutor
// row, the lesson row, the new-items row, the sounds row, the letter row, the map
// strip, and the five secondary links along the bottom. They are the session's steps
// or they are in the Library.

/** The completion beat: one factual sentence, and — only when one genuinely exists —
 *  the E-38 thread citing something the learner actually said today. Both together
 *  are ONE beat, which is what D-24 allows per day; the ring closing is the other
 *  half of it and there is no third. */
function CompletionBeat({ view }: { view: TodayView }) {
  if (!view.completion) return null;
  return (
    <>
      <p data-completion className="text-[17px] text-ink">
        {completionSentence(view.completion)}
      </p>
      {view.thread && (
        <p data-today-thread data-thread-item={view.thread.itemId} className="text-[15px] text-secondary">
          {threadSentence(view.thread)}
        </p>
      )}
    </>
  );
}

export function LearnToday({ view }: { view: TodayView }) {
  const { action } = view;
  return (
    <div data-learn-today data-day-complete={view.complete ? "true" : "false"} className="mx-auto max-w-xl p-8">
      <h1 className="text-[34px] font-bold tracking-tight">Today</h1>

      <section
        data-today-goal
        className="mt-6 flex flex-col items-center gap-4 rounded-card bg-card p-8 text-center shadow-card"
      >
        {/* [E-46] The ring is the way in to "what Erika knows about you". It already
            stands for the whole of your progress, so it is the natural affordance and
            it costs the home screen no new row, no new label and no new pixel — which
            is why it does not weaken E-44's one-screen-one-action rule. The primary
            action below is still the only thing on this screen that TELLS you to do
            something. */}
        <Link
          href="/progress"
          data-open-progress
          aria-label="What Erika knows about you"
          className="rounded-full transition-transform active:scale-[0.98]"
        >
          <GoalRing done={view.goal.done} total={view.goal.total} />
        </Link>
        {view.complete ? (
          <CompletionBeat view={view} />
        ) : (
          <p data-today-summary className="text-[17px] leading-[1.47] text-ink">
            {view.summary}
          </p>
        )}
        {/* The streak (E-38, D-24): one caption line with its repair disclosure, or
            nothing at all. A run of zero renders NOTHING — no nag, no countdown. */}
        <StreakLine streak={view.streak} today={view.day} />
      </section>

      {action.kind !== "none" && (
        <Link
          href={action.href}
          data-primary-action={action.kind}
          className="mt-6 flex w-full items-center justify-center rounded-full bg-accent px-6 py-3.5 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
