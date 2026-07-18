"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Check, Plus } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import {
  filterEntries,
  CATEGORY_ORDER,
  type CategoryFilter,
  type PhrasebookEntry,
} from "@/lib/phrasebook";
import { SEVERITY_STYLES } from "@/lib/analysis-view";

// The Phrasebook (E-9, v0.2): a searchable library of every recast Erika built
// from your findings — "you say X, natives say Y" — side by side, with the why,
// category, and severity. Free-text search and a category segmented control
// narrow it (pure filterEntries, client-side). Any entry pins into the flashcard
// deck (clearing a prior deletion). DESIGN — calm two-column rows, ink accent,
// red/orange only as meaning (severity); "in deck" is a quiet neutral fact, not
// an achievement; a plain search input and quiet chips; one stagger on entry.

// Severity styling comes whole from the shared SEVERITY_STYLES (D-14, E-18
// criterion 6): red high, orange medium, low neutral — green is reserved for
// resolved/mastered/improving, which no phrasebook row is.

const FILTERS: CategoryFilter[] = ["all", ...CATEGORY_ORDER];

export default function PhrasebookPage() {
  const reduced = usePrefersReducedMotion();
  const [entries, setEntries] = useState<PhrasebookEntry[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [pinning, setPinning] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/phrasebook")
      .then((r) => r.json())
      .then((b: { entries: PhrasebookEntry[] }) => alive && setEntries(b.entries))
      .catch(() => alive && setEntries([]));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(
    () => (entries ? filterEntries(entries, { query, category }) : []),
    [entries, query, category],
  );

  async function pin(findingId: string) {
    setPinning(findingId);
    try {
      const res = await fetch(`/api/phrasebook/${findingId}/pin`, { method: "POST" });
      if (res.ok) {
        setEntries((es) =>
          es ? es.map((e) => (e.findingId === findingId ? { ...e, inDeck: true } : e)) : es,
        );
      }
    } finally {
      setPinning(null);
    }
  }

  if (entries === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Reading your recasts…</p>
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        title="Phrasebook"
        line="Your recasts collect here once Erika has analyzed a session — what you said beside how a native says it. Nothing yet."
        action="Go to sessions"
        href="/"
      />
    );
  }

  return (
    <div data-phrasebook className="mx-auto max-w-3xl p-8">
      <header className="mb-6">
        <h1 className="text-[34px] font-bold tracking-tight">Phrasebook</h1>
        <p className="mt-1 tabular text-[13px] text-secondary">
          {entries.length} {entries.length === 1 ? "recast" : "recasts"} from your speech
        </p>
      </header>

      <div className="mb-6 flex flex-col gap-3">
        <input
          type="search"
          data-search
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your phrases and recasts"
          className="w-full rounded-control bg-card px-4 py-2.5 text-[15px] text-ink shadow-card outline-none placeholder:text-secondary"
        />
        <div data-category-filter className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          {FILTERS.map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                data-category-chip={c}
                aria-pressed={active}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium capitalize transition-colors ${
                  active ? "bg-accent text-accent-ink" : "bg-card text-secondary hover:text-ink"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      </div>

      {shown.length === 0 ? (
        <p data-no-match className="rounded-card bg-card p-6 text-[15px] text-secondary shadow-card">
          No recasts match your search.
        </p>
      ) : (
        <motion.ul
          key={`${query}|${category}`}
          variants={staggerContainer(reduced)}
          initial="initial"
          animate="animate"
          data-entries
          className="flex flex-col gap-3"
        >
          {shown.map((entry) => (
            <Row
              key={entry.findingId}
              entry={entry}
              reduced={reduced}
              busy={pinning === entry.findingId}
              onPin={() => void pin(entry.findingId)}
            />
          ))}
        </motion.ul>
      )}
    </div>
  );
}

function Row({
  entry,
  reduced,
  busy,
  onPin,
}: {
  entry: PhrasebookEntry;
  reduced: boolean;
  busy: boolean;
  onPin: () => void;
}) {
  const sev = SEVERITY_STYLES[entry.severity];
  return (
    <motion.li
      variants={staggerItem(reduced)}
      data-entry
      data-entry-id={entry.findingId}
      data-in-deck={entry.inDeck}
      className="flex flex-col gap-4 rounded-card bg-card p-5 shadow-card"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Side label="You say" text={entry.quote} />
        <Side label="Natives say" text={entry.correction} accent />
      </div>

      {entry.explanation && (
        <p className="text-[15px] leading-[1.47] text-secondary">{entry.explanation}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            {entry.category}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${sev.tint} ${sev.text}`}
          >
            {sev.label}
          </span>
        </div>

        {entry.inDeck ? (
          <span
            data-in-deck-marker
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-secondary"
          >
            <Check size={16} strokeWidth={1.5} aria-hidden />
            In deck
          </span>
        ) : (
          <button
            type="button"
            data-pin
            disabled={busy}
            onClick={onPin}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-40"
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden />
            {busy ? "Pinning…" : "Pin to deck"}
          </button>
        )}
      </div>
    </motion.li>
  );
}

function Side({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
        {label}
      </span>
      <p className={`text-[17px] leading-[1.47] ${accent ? "font-semibold text-ink" : "text-ink"}`}>
        “{text}”
      </p>
    </div>
  );
}
