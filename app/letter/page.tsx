"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { EmptyState } from "@/components/empty-state";
import { LetterBody, LetterHeader } from "@/components/letter-body";
import type { Letter } from "@/lib/letter";

// The editor's letter (E-12), reachable from the Library (E-44). Its once-a-week beat
// now lives INSIDE the daily session; this page is where you come back to read it
// again, or read it at all if you never opened the session that week.
//
// The rendering is `components/letter-body.tsx`, shared verbatim with the session
// step — one editorial voice, one implementation. The E-24 read/write split is
// unchanged: the GET does not mark it read; the explicit POST does.

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
          <LetterHeader letter={letter} />
          <h1 className="mt-2 text-[34px] font-bold tracking-tight">{"This week's letter"}</h1>
        </motion.header>
        <motion.div variants={staggerItem(reduced)}>
          <LetterBody letter={letter} />
        </motion.div>
      </motion.article>
    </div>
  );
}
