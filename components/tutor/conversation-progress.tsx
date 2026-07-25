"use client";

import { formatElapsed } from "@/lib/recording";

// Calm progress toward the minimum that makes a conversation count (E-43 criterion 6,
// D-24). Geometry and numbers, nothing else.
//
// WHAT THIS DELIBERATELY IS NOT, because D-24's ban list is the binding part: not a
// gamified meter, not a countdown, not a warning, and there is no guilt copy anywhere
// on the path — a learner who leaves at 1:40 of 5:00 sees nothing about it, here or
// after. No confetti, no badge, no celebratory beat: reaching the minimum swaps one
// factual line for another and that is the entire acknowledgement (D-24 allows at most
// one celebratory beat per day, and it is not this surface's to spend — WO-E44 owns
// the day's completion moment).
//
// The bar is a hairline in ink, the numbers are tabular, and the whole thing reads
// "3:12 of 5:00" — a statement of where you are, not a demand.

export function ConversationProgress({
  elapsedMs,
  minSeconds,
}: {
  elapsedMs: number;
  minSeconds: number;
}) {
  if (minSeconds <= 0) {
    return (
      <p data-tutor-timer className="tabular text-[22px] font-semibold text-ink" aria-label="Elapsed">
        {formatElapsed(elapsedMs)}
      </p>
    );
  }

  const minMs = minSeconds * 1000;
  const met = elapsedMs >= minMs;
  const fraction = Math.max(0, Math.min(1, elapsedMs / minMs));

  return (
    <div className="flex w-full max-w-xs flex-col items-center gap-2">
      <p data-tutor-timer className="tabular text-[22px] font-semibold text-ink" aria-label="Elapsed">
        {formatElapsed(elapsedMs)}
      </p>
      <div
        className="h-px w-full overflow-hidden bg-hairline"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={minSeconds}
        aria-valuenow={Math.min(minSeconds, Math.round(elapsedMs / 1000))}
        aria-label="Progress toward today's conversation"
        data-tutor-progress
        data-met={met ? "true" : "false"}
      >
        <div className="h-px bg-accent" style={{ width: `${fraction * 100}%` }} />
      </div>
      <p className="tabular text-[13px] text-secondary" data-tutor-progress-label>
        {met ? "Counts toward today" : `${formatElapsed(elapsedMs)} of ${formatElapsed(minMs)}`}
      </p>
    </div>
  );
}
