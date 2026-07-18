import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { CategoryMetric, TrendDirection } from "@/lib/focus";

// The ranked "what to work on next" list (E-7). Each category is a hand-rolled,
// monochrome SVG bar sized by its severity-weighted rate — the higher the bar,
// the more it costs you — with the plain per-hour rate and count in tabular
// numerals. The only colour is the trend arrow (D-14: colour = meaning): a
// falling rate reads green (improving), a rising one red (worsening).

const TREND: Record<TrendDirection, { label: string; className: string; Icon: typeof Minus }> = {
  improving: { label: "improving", className: "text-good", Icon: ArrowDownRight },
  worsening: { label: "worsening", className: "text-severe", Icon: ArrowUpRight },
  flat: { label: "steady", className: "text-secondary", Icon: Minus },
};

/** A small trend arrow + word — the one place green/red appears on this screen. */
export function TrendBadge({ trend }: { trend: TrendDirection }) {
  const t = TREND[trend];
  return (
    <span
      data-trend={trend}
      className={`inline-flex items-center gap-1 text-[13px] font-medium ${t.className}`}
    >
      <t.Icon size={16} strokeWidth={1.5} aria-hidden />
      {t.label}
    </span>
  );
}

function rate(n: number): string {
  return n.toFixed(1);
}

export function CategoryBars({ ranking }: { ranking: CategoryMetric[] }) {
  const max = Math.max(...ranking.map((m) => m.weightedRatePerHour), 1);
  return (
    <ul className="flex flex-col gap-3" data-category-bars>
      {ranking.map((m) => (
        <li
          key={m.category}
          data-category-rank={m.category}
          className="grid grid-cols-[7.5rem_1fr_auto] items-center gap-4"
        >
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            {m.category}
          </span>
          <div className="flex items-center gap-3">
            <svg
              width="100%"
              height={10}
              viewBox="0 0 100 10"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${m.category} weighted rate`}
              className="text-ink"
            >
              <rect x={0} y={0} width={100} height={10} rx={5} className="fill-hairline" />
              <rect
                x={0}
                y={0}
                width={Math.max((m.weightedRatePerHour / max) * 100, m.count > 0 ? 2 : 0)}
                height={10}
                rx={5}
                fill="currentColor"
              />
            </svg>
            <TrendBadge trend={m.trend} />
          </div>
          <span className="tabular whitespace-nowrap text-right text-[13px] text-secondary">
            <span className="text-ink">{rate(m.ratePerHour)}</span>/hr ·{" "}
            {m.count} {m.count === 1 ? "slip" : "slips"}
          </span>
        </li>
      ))}
    </ul>
  );
}
