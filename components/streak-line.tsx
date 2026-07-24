import { streakCaption } from "@/lib/streak/caption";
import type { StreakRepair } from "@/lib/streak/compute";

// The streak, rendered (E-38, DESIGN.md:42-49 / D-24). One caption-style line under
// the goal ring — "Day 14", or "Day 14 · repaired Tue" — and nothing else, ever.
//
// Deliberately absent, and a reviewer should be able to confirm it by reading this
// whole file: no flame or any other icon, no badge, points, level or trophy, no
// celebratory animation (the ring closing is the day's single beat, D-24), no
// countdown of remaining repairs, no warning that the run is at risk, no red or
// alarm styling for a missed day, and no copy at all when the run is zero — a
// learner who missed yesterday is shown NOTHING rather than a nag. Green is not
// spent here: showing up is not mastery (D-14/D-24).
//
// SENTENCE CASE, not the uppercase `CAPTION` token (review F4, operator ruling). That
// token is reserved for SECTION LABELS ("REVIEW", "YOUR MAP"); this is a sentence, and
// DESIGN:53 says sentence case everywhere. "Day 14 · repaired Tue" is information, and
// setting it in caps reads louder than the number deserves. Caption WEIGHT and size
// are kept — it is still a caption, just not a label.

export function StreakLine({
  streak,
  today,
}: {
  streak: { currentRun: number; repairedDays: readonly StreakRepair[] };
  today: string;
}) {
  const caption = streakCaption(streak, today);
  if (caption === null) return null;
  return (
    <p
      data-streak
      data-streak-run={streak.currentRun}
      className="tabular text-[13px] font-medium text-secondary"
    >
      {caption}
    </p>
  );
}
