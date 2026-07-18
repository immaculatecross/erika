// A hand-rolled, monochrome SVG sparkline — no charting library (DESIGN.md
// sanctions only Motion + Lucide). It plots the trend of a rate across
// chronological buckets in ink; the semantic green/red of "improving" vs
// "worsening" lives with the label beside it, never in a category rainbow.

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ values, width = 260, height = 60 }: SparklineProps) {
  const pad = 6;
  const w = width - pad * 2;
  const h = height - pad * 2;
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const n = values.length;

  // x evenly spaced; y inverted so a lower rate (better) sits higher on the page.
  const x = (i: number) => (n <= 1 ? w / 2 : (i / (n - 1)) * w) + pad;
  const y = (v: number) => pad + h - ((v - min) / span) * h;

  const points = values.map((v, i) => [x(i), y(v)] as const);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Error rate over time"
      data-sparkline
      className="text-ink"
    >
      {/* A hairline baseline for reference. */}
      <line
        x1={pad}
        y1={pad + h}
        x2={pad + w}
        y2={pad + h}
        className="stroke-hairline"
        strokeWidth={1}
      />
      {n >= 2 && (
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={points.map(([px, py]) => `${px},${py}`).join(" ")}
        />
      )}
      {/* The latest point — the number that matters — reads as a filled dot. */}
      {n >= 1 && (
        <circle cx={points[n - 1][0]} cy={points[n - 1][1]} r={3} fill="currentColor" />
      )}
    </svg>
  );
}
