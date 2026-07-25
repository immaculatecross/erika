"use client";

import { useEffect, useState } from "react";
import { LetterBody, LetterHeader } from "@/components/letter-body";
import type { Letter } from "@/lib/letter";

// Step three, once a week: the editor's letter (E-44 criterion 5, D-26). The
// operator's own example of a demoted surface that earns a place in the daily flow —
// so it stops being a row on the home and becomes a beat inside the session.
//
// It sits BEFORE the conversation deliberately: its closing line is "the one thing
// next week", which is exactly what the conversation should steer toward. Reading it
// after would end the day on last week instead of on the learner's own voice.
//
// The E-24 contract is untouched: the GET does not mark it read, and this POSTs
// `/api/letter/viewed` with the week shown — the same call the standalone page makes,
// against the same forward-only marker. Marking it read is what takes the step out of
// tomorrow's session; the step's own completion is verified against that marker
// server-side, so a letter that failed to record as read is a step that stays open
// rather than a day that silently completes.

export function LetterStep({ onDone }: { onDone: () => void }) {
  const [letter, setLetter] = useState<Letter | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch("/api/letter")
      .then((r) => r.json())
      .then(async (b: { letter: Letter | null }) => {
        if (!alive) return;
        setLetter(b.letter);
        if (!b.letter) return;
        await fetch("/api/letter/viewed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ week: b.letter.weekStart }),
        }).catch(() => {});
      })
      .catch(() => alive && setLetter(null));
    return () => {
      alive = false;
    };
  }, []);

  if (letter === undefined) {
    return <p className="text-[15px] text-secondary">Reading your week…</p>;
  }

  return (
    <div data-step-letter className="flex flex-col gap-6">
      {letter && <LetterHeader letter={letter} />}
      <h1 className="text-[34px] font-bold tracking-tight">This week&rsquo;s letter</h1>
      {letter ? (
        <LetterBody letter={letter} />
      ) : (
        <p className="text-[17px] leading-[1.47] text-secondary">
          Your letter could not be read. It will be waiting next time — nothing is lost.
        </p>
      )}
      <button
        type="button"
        data-step-continue
        onClick={onDone}
        className="self-start rounded-full bg-accent px-6 py-3 text-[17px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
      >
        Continue
      </button>
    </div>
  );
}
