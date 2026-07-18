"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Play } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { formatCreatedAt, formatDuration } from "@/lib/format";
import { EmptyState } from "@/components/empty-state";
import {
  filterEntries,
  groupBySession,
  CATEGORY_ORDER,
  SEVERITY_ORDER,
  type ArchiveEntry,
  type ArchiveGroup,
  type CategoryFilter,
  type SeverityFilter,
} from "@/lib/archive";
import { SEVERITY_STYLES } from "@/lib/analysis-view";

// The Speech archive (E-11, v0.2): your speaking life at a glance — every analyzed
// moment in chronological order, newest session first, grouped by session, each
// row linking back to its audio at the finding's timestamp. Free-text search plus
// category and severity filters narrow it (pure, client-side, intersected). DESIGN
// — calm chronological rows and day/session headers, ink accent, green/red only as
// meaning (severity), tabular numerals for timestamps; a plain search input and
// quiet chips; one signature stagger on entry. Empty state until a session is analyzed.

// Severity styling comes whole from the shared SEVERITY_STYLES (D-14, E-18
// criterion 6): red high, orange medium, low neutral — green is reserved for
// resolved/mastered/improving, which no archived slip is.

const CATEGORY_FILTERS: CategoryFilter[] = ["all", ...CATEGORY_ORDER];
const SEVERITY_FILTERS: SeverityFilter[] = ["all", ...SEVERITY_ORDER];

export default function ArchivePage() {
  const reduced = usePrefersReducedMotion();
  const [entries, setEntries] = useState<ArchiveEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [severity, setSeverity] = useState<SeverityFilter>("all");

  useEffect(() => {
    let alive = true;
    fetch("/api/archive")
      .then((r) => r.json())
      .then((b: { entries: ArchiveEntry[] }) => alive && setEntries(b.entries))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo<ArchiveGroup[]>(
    () => (entries ? groupBySession(filterEntries(entries, { query, category, severity })) : []),
    [entries, query, category, severity],
  );

  if (entries === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Reading your archive…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Archive"
        line="Every analyzed moment of your speech collects here in time order once Erika has analyzed a session. Nothing yet."
        action="Go to sessions"
        href="/"
      />
    );
  }

  return (
    <div data-archive className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Archive</h1>
        <p className="mt-1 tabular text-[13px] text-secondary">
          {entries.length} {entries.length === 1 ? "moment" : "moments"} across your speech
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3">
        <input
          type="search"
          data-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what you said and its recast"
          className="w-full rounded-control bg-card px-4 py-2.5 text-[15px] text-ink shadow-card outline-none placeholder:text-secondary"
        />
        <Chips label="Filter by category" value={category} options={CATEGORY_FILTERS} onPick={setCategory} kind="category" />
        <Chips label="Filter by severity" value={severity} options={SEVERITY_FILTERS} onPick={setSeverity} kind="severity" />
      </div>

      {groups.length === 0 ? (
        <p data-no-match className="rounded-card bg-card p-6 text-[15px] text-secondary shadow-card">
          No moments match your search.
        </p>
      ) : (
        <div key={`${query}|${category}|${severity}`} className="flex flex-col gap-8">
          {groups.map((g) => (
            <Group key={g.sessionId} group={g} reduced={reduced} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chips<T extends string>({
  label,
  value,
  options,
  onPick,
  kind,
}: {
  label: string;
  value: T;
  options: T[];
  onPick: (v: T) => void;
  kind: "category" | "severity";
}) {
  return (
    <div data-filter={kind} className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            data-chip={`${kind}:${o}`}
            aria-pressed={active}
            onClick={() => onPick(o)}
            className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors ${
              active ? "bg-accent text-accent-ink" : "bg-card text-secondary hover:text-ink"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function Group({ group, reduced }: { group: ArchiveGroup; reduced: boolean }) {
  return (
    <section data-group data-session-id={group.sessionId}>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="tabular text-[15px] font-semibold text-ink">{formatCreatedAt(group.sessionCreatedAt)}</h2>
        <span className="min-w-0 truncate text-[13px] text-secondary">{group.sessionFilename}</span>
      </div>
      <motion.ul
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-2"
      >
        {group.entries.map((e) => (
          <Row key={e.findingId} entry={e} reduced={reduced} />
        ))}
      </motion.ul>
    </section>
  );
}

function Row({ entry, reduced }: { entry: ArchiveEntry; reduced: boolean }) {
  const sev = SEVERITY_STYLES[entry.severity];
  return (
    <motion.li variants={staggerItem(reduced)}>
      <Link
        href={`/sessions/${entry.sessionId}?t=${entry.startMs}`}
        data-entry
        data-entry-id={entry.findingId}
        data-start-ms={entry.startMs}
        className="flex items-center gap-3 rounded-control bg-card px-4 py-3 shadow-card transition-transform hover:bg-hairline active:scale-[0.99]"
      >
        <span className="tabular w-14 shrink-0 text-[13px] text-secondary">
          {formatDuration(entry.startMs / 1000)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[17px] text-ink">“{entry.quote}”</span>
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
    </motion.li>
  );
}
