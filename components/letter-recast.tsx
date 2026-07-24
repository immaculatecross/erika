"use client";

import { RevealableError } from "@/components/revealable-error";
import { SEVERITY_STYLES } from "@/lib/analysis-view";
import type { LetterFinding } from "@/lib/letter";

// One of the letter's best recasts, correction-forward (E-30 P1, D-18). The editor
// leads with how a native says it — the recast is the lesson worth keeping — and
// the "you said" is kept behind one tap (RevealableError: absent from the DOM until
// revealed, then shown once and marked). The old side-by-side headlined the error;
// D-18 forbids an erroneous form as a primary stimulus, so it moves subordinate.
// Severity styling is the shared SEVERITY_STYLES (D-14): only red/orange carry
// meaning here; low reads neutral.

export function LetterRecast({ recast }: { recast: LetterFinding }) {
  const sev = SEVERITY_STYLES[recast.severity];
  return (
    <div
      data-recast
      data-recast-id={recast.id}
      className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-secondary">
          Natives say
        </span>
        <p data-recast-correction className="text-[17px] font-semibold leading-[1.47] text-ink">
          “{recast.correction}”
        </p>
      </div>

      <RevealableError text={recast.quote} />

      {recast.explanation && (
        <p className="text-[15px] leading-[1.47] text-secondary">{recast.explanation}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
          {recast.category}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.06em] ${sev.tint} ${sev.text}`}
        >
          {sev.label}
        </span>
      </div>
    </div>
  );
}
