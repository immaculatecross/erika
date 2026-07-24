"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { staggerItem } from "@/lib/motion";
import { formatDuration } from "@/lib/format";
import { RevealableError } from "@/components/revealable-error";
import { SEVERITY_STYLES } from "@/lib/analysis-view";
import type { ArchiveEntry } from "@/lib/archive";

// One archived moment, correction-forward (E-30 P1, D-18). The row leads with the
// recast — the correct form is the record you scan and the deep link back to its
// audio — and the mistake you actually made is kept behind one tap (RevealableError:
// genuinely absent from the DOM until revealed, then shown once and marked). The
// headline links to the session at the finding's timestamp; the reveal is a
// separate quiet control below, so an erroneous form is never the primary stimulus.
// Severity styling is the shared SEVERITY_STYLES (D-14): red/orange carry meaning,
// low reads neutral — green is never a mistake.

export function ArchiveRow({ entry, reduced }: { entry: ArchiveEntry; reduced: boolean }) {
  const sev = SEVERITY_STYLES[entry.severity];
  return (
    <motion.li
      variants={staggerItem(reduced)}
      data-entry
      data-entry-id={entry.findingId}
      data-start-ms={entry.startMs}
      className="flex flex-col gap-2 rounded-control bg-card px-4 py-3 shadow-card"
    >
      <Link
        href={`/sessions/${entry.sessionId}?t=${entry.startMs}`}
        data-entry-jump
        className="flex items-center gap-3 transition-transform hover:opacity-80 active:scale-[0.99]"
      >
        <span className="tabular w-14 shrink-0 text-[13px] text-secondary">
          {formatDuration(entry.startMs / 1000)}
        </span>
        <span data-entry-correction className="min-w-0 flex-1 truncate text-[17px] text-ink">
          “{entry.correction}”
        </span>
        <span className="hidden shrink-0 text-[13px] uppercase tracking-[0.06em] text-secondary sm:inline">
          {entry.category}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${sev.tint} ${sev.text}`}
        >
          {sev.label}
        </span>
        <Play size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-secondary" />
      </Link>
      <RevealableError text={entry.quote} />
    </motion.li>
  );
}
