"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { TrendBadge } from "@/components/category-bars";
import { LetterRecast } from "@/components/letter-recast";
import type { Letter } from "@/lib/letter";

// The editor's letter (E-12, v0.2 — the finale): a quiet weekly digest, the
// narrative counterpart to the Focus map. One headline stat (this week's error
// rate) with its trend against last week, a few of your best recasts side by side,
// and the one thing to work on next. Reached from the Focus screen (no new nav
// item). DESIGN — editorial and calm, generous space, ink accent, green/red only
// where the trend carries meaning (D-14), tabular numerals; no gamification —
// Erika speaks like a good editor, always specific, never cheerleading.

// Severity styling comes whole from the shared SEVERITY_STYLES (D-14, E-18
// criterion 6): red high, orange medium, low neutral — green is reserved for
// resolved/mastered/improving, and here only the improving trend earns it.

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
function trendLine(letter: Letter): string {
  const { trend } = letter;
  const rate = `${n1(trend.current)} ${trend.current === 1 ? "error" : "errors"} per speaking hour`;
  if (!trend.hasPrior) return `${rate} this week — your first letter, so there's no prior week to compare yet.`;
  const prior = n1(trend.prior as number);
  if (trend.direction === "improving") return `Down to ${rate}, from ${prior} the week before.`;
  if (trend.direction === "worsening") return `Up to ${rate}, from ${prior} the week before.`;
  return `Steady at ${rate}, level with the week before.`;
}

export default function LetterPage() {
  const reduced = usePrefersReducedMotion();
  const [letter, setLetter] = useState<Letter | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/letter")
      .then((r) => r.json())
      .then((b: { letter: Letter | null }) => {
        if (!alive) return;
        setLetter(b.letter);
        // Record the read only AFTER showing the letter — the GET no longer
        // writes (E-24), so this explicit POST is what flips the plan's
        // `letterUnread`. Fire-and-forget; the week defaults to the one shown.
        if (b.letter) {
          void fetch("/api/letter/viewed", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ week: b.letter.weekStart }),
          }).catch(() => {});
        }
      })
      .catch(() => alive && setLetter(null));
    return () => {
      alive = false;
    };
  }, []);

  if (letter === undefined) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Reading your week…</p>
      </div>
    );
  }

  if (letter === null) {
    return (
      <EmptyState
        title="This week's letter"
        line="Your weekly letter arrives once Erika has analyzed a session — your trend, your best recasts, and the one thing to work on next. Nothing analyzed yet."
        action="Go to sessions"
        href="/"
      />
    );
  }

  return (
    <div data-letter className="mx-auto max-w-2xl p-8">
      <motion.article
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-10"
      >
        <motion.header variants={staggerItem(reduced)}>
          <p className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            The week of {shortDate(letter.weekStart)} – {shortDate(letter.weekEnd)}
          </p>
          <h1 className="mt-2 text-[34px] font-bold tracking-tight">{"This week's letter"}</h1>
        </motion.header>

        <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-3">
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
        </motion.section>

        {letter.recasts.length > 0 && (
          <motion.section variants={staggerItem(reduced)} className="flex flex-col gap-4" data-recasts>
            <h2 className="text-[22px] font-semibold tracking-tight">Your best recasts</h2>
            <div className="flex flex-col gap-3">
              {letter.recasts.map((r) => (
                <LetterRecast key={r.id} recast={r} />
              ))}
            </div>
          </motion.section>
        )}

        {letter.focusNext && (
          <motion.section
            variants={staggerItem(reduced)}
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
          </motion.section>
        )}
      </motion.article>
    </div>
  );
}
