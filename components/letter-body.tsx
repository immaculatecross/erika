import { TrendBadge } from "./category-bars";
import { LetterRecast } from "./letter-recast";
import type { Letter } from "@/lib/letter";

// The editor's letter, rendered (E-12) — extracted at E-44 so the standalone `/letter`
// page and the once-a-week step INSIDE the daily session render the same letter from
// the same code. Two copies of an editorial voice would drift; one cannot.
//
// Pure and prop-driven. The viewed-marker POST (the E-24 contract) stays with the
// callers, because "I showed it" is a different fact from "here is how it looks".

/** "YYYY-MM-DD" (UTC) → a short human date, e.g. "Jul 13". */
function shortDate(ymd: string): string {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function n1(x: number): string {
  return x.toFixed(1);
}

/** The trend sentence, in the editor's voice — specific, never inflated. */
export function trendLine(letter: Letter): string {
  const { trend } = letter;
  const rate = `${n1(trend.current)} ${trend.current === 1 ? "error" : "errors"} per speaking hour`;
  if (!trend.hasPrior) return `${rate} this week — your first letter, so there's no prior week to compare yet.`;
  const prior = n1(trend.prior as number);
  if (trend.direction === "improving") return `Down to ${rate}, from ${prior} the week before.`;
  if (trend.direction === "worsening") return `Up to ${rate}, from ${prior} the week before.`;
  return `Steady at ${rate}, level with the week before.`;
}

export function LetterHeader({ letter }: { letter: Letter }) {
  return (
    <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
      The week of {shortDate(letter.weekStart)} – {shortDate(letter.weekEnd)}
    </p>
  );
}

export function LetterBody({ letter }: { letter: Letter }) {
  return (
    <div data-letter-body className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        {letter.rateReliable ? (
          <>
            <div className="flex items-end gap-4">
              <p className="tabular text-[34px] font-bold leading-none tracking-tight text-ink" data-letter-rate>
                {Math.round(letter.ratePerHour)}
              </p>
              {letter.trend.hasPrior && <TrendBadge trend={letter.trend.direction} />}
            </div>
            <p className="text-[17px] leading-[1.47] text-ink">{trendLine(letter)}</p>
          </>
        ) : (
          <>
            <p className="tabular text-[34px] font-bold leading-none tracking-tight text-ink" data-letter-count>
              {letter.totalFindings}
            </p>
            <p className="text-[17px] leading-[1.47] text-ink" data-letter-floor>
              {letter.totalFindings} {letter.totalFindings === 1 ? "finding" : "findings"} this week — not
              enough analyzed speech yet for a reliable per-hour rate.
            </p>
          </>
        )}
        <p className="tabular text-[13px] text-secondary">
          {letter.totalFindings} {letter.totalFindings === 1 ? "finding" : "findings"} across{" "}
          {n1(letter.speechHours)} h of analyzed speech · {letter.analyzedSessions}{" "}
          {letter.analyzedSessions === 1 ? "session" : "sessions"}
        </p>
      </section>

      {letter.recasts.length > 0 && (
        <section className="flex flex-col gap-4" data-recasts>
          <h2 className="text-[22px] font-semibold tracking-tight">Your best recasts</h2>
          <div className="flex flex-col gap-3">
            {letter.recasts.map((r) => (
              <LetterRecast key={r.id} recast={r} />
            ))}
          </div>
        </section>
      )}

      {letter.focusNext && (
        <section
          data-focus-next
          data-focus-next-category={letter.focusNext.category}
          className="flex flex-col gap-2 rounded-card bg-card p-6 shadow-card"
        >
          <h2 className="text-[22px] font-semibold tracking-tight">The one thing next week</h2>
          <p className="text-[17px] leading-[1.47] text-ink">
            Work on your <span className="font-semibold capitalize">{letter.focusNext.category}</span> —{" "}
            <span className="tabular">
              {letter.focusNext.count} {letter.focusNext.count === 1 ? "slip" : "slips"}
              {letter.rateReliable ? `, ${Math.round(letter.focusNext.ratePerHour)} per hour` : ""}
            </span>
            , the pattern costing you the most this week.
          </p>
        </section>
      )}
    </div>
  );
}
