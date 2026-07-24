import type { MapCell } from "@/lib/knowledge-map";

// The Learn map strip (E-38, D-24 / DESIGN.md:47). One cell per category, hand-rolled
// — no charting library — tinting toward `good` ONLY as that category's recurring
// mistakes get RESOLVED. Green is mastery here exactly as it is everywhere else
// (D-14): a busy category with nothing resolved stays neutral hairline, which is the
// honest reading. No badges, no scores, no celebration — a quiet strip of state.
//
// The tint steps are literal class names (band → class) rather than a computed
// string, so Tailwind actually emits them and the rendered surface is assertable.

const BAND_CLASS = [
  "bg-hairline", // 0 — nothing resolved: never green
  "bg-good/20",
  "bg-good/40",
  "bg-good/65",
  "bg-good",
] as const;

function cellLine(cell: MapCell): string {
  if (cell.slips === 0) return "no recurring mistakes";
  return `${cell.resolved} of ${cell.slips} resolved`;
}

export function KnowledgeMap({ cells }: { cells: MapCell[] }) {
  return (
    <div className="flex flex-col gap-3" data-knowledge-map>
      <div className="grid grid-cols-5 gap-2">
        {cells.map((cell) => (
          <div
            key={cell.category}
            data-map-cell={cell.category}
            data-band={cell.band}
            data-resolved={cell.resolved}
            data-slips={cell.slips}
            title={`${cell.category} — ${cellLine(cell)}`}
            className="flex flex-col gap-1.5"
          >
            <div
              className={`h-10 rounded-[8px] ${BAND_CLASS[cell.band] ?? BAND_CLASS[0]}`}
              role="img"
              aria-label={`${cell.category}: ${cellLine(cell)}`}
            />
            <span className="truncate text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
              {cell.category}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
