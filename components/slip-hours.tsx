import type { SlipHourDistribution } from "@/lib/slip-hours";

// "When you slip" (E-22 criterion 3): the hour-of-day distribution of findings, as
// a quiet monochrome histogram — 24 ink bars, one per hour of the LEARNER'S OWN
// clock (E-38/RETRO-003 corrected this from UTC; D-24: the user's day is local),
// the busiest hour the one that reads at full ink (DESIGN.md: the one number that
// matters; green is never spent here, a slip is not a win). Hand-rolled like the
// sparkline and the category bars: no charting library. Counts in tabular numerals.

const HOUR_LABELS = [0, 6, 12, 18, 23];

function hh(h: number): string {
  return String(h).padStart(2, "0");
}

export function SlipHours({ distribution }: { distribution: SlipHourDistribution }) {
  const { buckets, peakHour, peakCount, total } = distribution;
  const max = Math.max(peakCount, 1);

  return (
    <div className="flex flex-col gap-3" data-slip-hours data-slip-total={total}>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label="Findings by hour of day, your local time">
        {buckets.map((n, h) => {
          const isPeak = peakCount > 0 && h === peakHour;
          return (
            <div
              key={h}
              data-slip-hour={h}
              data-count={n}
              title={`${hh(h)}:00 — ${n} ${n === 1 ? "slip" : "slips"}`}
              className="flex flex-1 items-end justify-center self-stretch"
            >
              <div
                className={`w-full rounded-[3px] ${n > 0 ? (isPeak ? "bg-ink" : "bg-ink/25") : "bg-hairline"}`}
                style={{ height: n > 0 ? `max(3px, ${(n / max) * 100}%)` : "1px" }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px]">
        {buckets.map((_, h) => (
          <span
            key={h}
            className="flex-1 text-center text-[11px] font-medium uppercase tracking-[0.06em] tabular text-secondary"
          >
            {HOUR_LABELS.includes(h) ? hh(h) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
