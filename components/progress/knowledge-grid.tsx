"use client";

import { motion } from "framer-motion";
import { SPRING } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { MapCell } from "@/lib/knowledge-map";

// The knowledge map, done properly (E-46 criterion 6). The Learn home carries a
// five-cell strip of anonymous squares; here each category is a named card that
// states its own arithmetic, because this is the screen where somebody has come to
// find out what Erika thinks of them and "a green square" is not an answer.
//
// The tint is the SAME resolved-slip semantics as the strip (lib/knowledge-map.ts,
// D-24): a category tints toward green only as its recurring mistakes are RESOLVED.
// Heavy activity with nothing resolved stays neutral. That is the whole reason green
// means something in this product, and a progress screen is precisely where the
// temptation to spend it on attendance lives.
//
// This is the surface's ONE signature moment: the cells settle in on a stagger with
// the standard spring, transform and opacity only, and degrade to a plain fade under
// prefers-reduced-motion. There is not a second one anywhere on the page.

const BAND_CLASS = [
  "bg-hairline", // 0 — nothing resolved: never green
  "bg-good/20",
  "bg-good/40",
  "bg-good/65",
  "bg-good",
] as const;

const STAGGER_MS = 40;

function cellLine(cell: MapCell): string {
  if (cell.slips === 0) return "Nothing recurring";
  return `${cell.resolved} of ${cell.slips} resolved`;
}

export function KnowledgeGrid({ cells }: { cells: MapCell[] }) {
  const reduced = usePrefersReducedMotion();
  return (
    <div data-knowledge-grid className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {cells.map((cell, i) => (
        <motion.div
          key={cell.category}
          data-map-cell={cell.category}
          data-band={cell.band}
          data-resolved={cell.resolved}
          data-slips={cell.slips}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={reduced ? { duration: 0.2 } : { ...SPRING, delay: (i * STAGGER_MS) / 1000 }}
          className="flex flex-col gap-2 rounded-card bg-card p-4 shadow-card"
        >
          <div className={`h-1.5 w-full rounded-full ${BAND_CLASS[cell.band] ?? BAND_CLASS[0]}`} aria-hidden />
          <span className="text-[15px] font-medium capitalize text-ink">{cell.category}</span>
          <span className="tabular text-[13px] text-secondary">{cellLine(cell)}</span>
        </motion.div>
      ))}
    </div>
  );
}
