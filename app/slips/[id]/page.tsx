"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Play, Layers, GraduationCap } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatCreatedAt, formatDuration } from "@/lib/format";
import { SlipStateBadge } from "@/components/slip-state-badge";
import type { DossierItem, SlipDossier } from "@/lib/slips";

type State = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; dossier: SlipDossier };

// A slip's dossier (E-20): its whole history on one chronological timeline —
// every occurrence (with jump-to-audio via the `/sessions/[id]?t=` deep link)
// interleaved with its drill (SM-2 card grades, lesson mastery). Reached from the
// slips index and from Focus. DESIGN — calm timeline, one accent, green reserved
// for the resolved/remission state badge (D-14), one stagger on entry.
export default function SlipDossierPage() {
  const { id } = useParams<{ id: string }>();
  const reduced = usePrefersReducedMotion();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    fetch(`/api/slips/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((dossier: SlipDossier) => setState({ kind: "ready", dossier }))
      .catch(() => setState({ kind: "missing" }));
  }, [id]);

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link
        href="/slips"
        className="mb-6 inline-flex items-center gap-1.5 text-[15px] text-secondary hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Slips
      </Link>

      {state.kind === "loading" && <p className="text-[15px] text-secondary">Reading the dossier…</p>}
      {state.kind === "missing" && (
        <p className="text-[17px] text-secondary">This slip no longer exists.</p>
      )}

      {state.kind === "ready" && <Dossier dossier={state.dossier} reduced={reduced} />}
    </div>
  );
}

function Dossier({ dossier, reduced }: { dossier: SlipDossier; reduced: boolean }) {
  return (
    <div data-slip-dossier data-slip-state={dossier.standing.state} className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
            {dossier.category}
          </span>
          <SlipStateBadge state={dossier.standing.state} />
        </div>
        <h1 className="break-words text-[34px] font-bold tracking-tight">“{dossier.correction}”</h1>
        <p className="tabular text-[15px] text-secondary">
          {dossier.statusLine} · {dossier.occurrences}{" "}
          {dossier.occurrences === 1 ? "occurrence" : "occurrences"}
        </p>
      </header>

      <motion.ol
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        data-timeline
        className="flex flex-col gap-3"
      >
        {dossier.timeline.map((item, i) => (
          <motion.li key={`${item.kind}-${i}`} variants={staggerItem(reduced)} data-timeline-item={item.kind}>
            <TimelineRow item={item} />
          </motion.li>
        ))}
      </motion.ol>
    </div>
  );
}

function TimelineRow({ item }: { item: DossierItem }) {
  if (item.kind === "occurrence") {
    return (
      <Link
        href={`/sessions/${item.sessionId}?t=${item.startMs}`}
        data-occurrence
        data-start-ms={item.startMs}
        className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card transition-transform hover:bg-hairline active:scale-[0.99]"
      >
        <span className="tabular w-24 shrink-0 text-[13px] text-secondary">{formatCreatedAt(item.at)}</span>
        <span className="min-w-0 flex-1 truncate text-[17px] text-ink">“{item.quote}”</span>
        <span className="tabular hidden shrink-0 text-[13px] text-secondary sm:inline">
          {formatDuration(item.startMs / 1000)}
        </span>
        <Play size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-secondary" />
      </Link>
    );
  }
  if (item.kind === "card") {
    const grade = item.grade ? `graded ${item.grade}` : "not yet reviewed";
    return (
      <div data-card className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card">
        <span className="tabular w-24 shrink-0 text-[13px] text-secondary">{formatCreatedAt(item.at)}</span>
        <Layers size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-secondary" />
        <span className="min-w-0 flex-1 text-[15px] text-ink">
          Card added to your deck — {grade}
          {item.repetitions > 0 ? ` · ${item.repetitions} in a row` : ""}
        </span>
        <span className="tabular hidden shrink-0 text-[13px] text-secondary sm:inline">
          due {formatCreatedAt(item.due)}
        </span>
      </div>
    );
  }
  return (
    <div data-mastery className="flex items-center gap-3 rounded-card bg-card p-4 shadow-card">
      <span className="tabular w-24 shrink-0 text-[13px] text-secondary">{formatCreatedAt(item.at)}</span>
      <GraduationCap size={16} strokeWidth={1.5} aria-hidden className="shrink-0 text-secondary" />
      <span className="min-w-0 flex-1 text-[15px] text-ink">
        Lesson practised — {item.category} mastery
      </span>
      <span className="tabular shrink-0 text-[15px] font-semibold text-ink">{item.mastery.toFixed(2)}</span>
    </div>
  );
}
