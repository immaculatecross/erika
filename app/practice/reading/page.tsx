"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { ListenButton } from "@/components/listen-button";
import type { CanonPassage } from "@/lib/canon";

// The reading/listening surface (E-33, D-23/D-19). A public-domain canon passage
// matched to the learner's edge, on a calm reading surface, with an optional listen
// (a register-aware TTS render, cached/ledgered). DESIGN.md: generous measure, body
// type at reading line-height, ink accent only, no second hue; the attribution sits
// quietly beneath. The listen is the one action.

interface ReadingResponse {
  edge: string;
  passage: CanonPassage | null;
  listen?: { exists: boolean; estimateUsd: number };
}

export default function ReadingPage() {
  const reduced = usePrefersReducedMotion();
  const [data, setData] = useState<ReadingResponse | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/reading")
      .then((r) => r.json())
      .then((d: ReadingResponse) => alive && setData(d))
      .catch(() => alive && setData({ edge: "A1", passage: null }));
    return () => {
      alive = false;
    };
  }, []);

  if (data === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Finding a passage at your level…</p>
      </div>
    );
  }

  const back = (
    <div className="mb-6">
      <Link
        href="/practice"
        className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Today
      </Link>
    </div>
  );

  if (!data.passage) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        {back}
        <h1 className="text-[34px] font-bold tracking-tight">Reading</h1>
        <p className="mt-4 text-[17px] text-secondary">No passage available right now.</p>
      </div>
    );
  }

  const p = data.passage;
  return (
    <div className="mx-auto max-w-2xl p-8">
      {back}
      <motion.article
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-6"
      >
        <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-1">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Reading · at your edge ({data.edge})
          </span>
          <h1 className="text-[34px] font-bold tracking-tight">{p.work}</h1>
          <p className="text-[15px] text-secondary">
            {p.author} · {p.year} · {p.cefr}
          </p>
        </motion.header>

        {/* The calm reading surface: body type, generous line-height, ample measure. */}
        <motion.p
          variants={staggerItem(reduced)}
          data-passage
          lang="it"
          className="whitespace-pre-line rounded-card bg-card p-7 text-[19px] leading-[1.7] text-ink shadow-card"
        >
          {p.text}
        </motion.p>

        <motion.div variants={staggerItem(reduced)} className="flex items-center gap-3">
          <ListenButton
            audioSrc={`/api/reading/${encodeURIComponent(p.id)}/audio`}
            renderUrl={`/api/reading/${encodeURIComponent(p.id)}`}
            exists={data.listen?.exists ?? false}
            estimateUsd={data.listen?.estimateUsd ?? 0}
            label="Listen"
          />
          <span className="text-[13px] text-secondary">Hear it read aloud in your register.</span>
        </motion.div>

        <motion.p variants={staggerItem(reduced)} className="text-[13px] text-secondary">
          Public domain. {p.source}.
        </motion.p>
      </motion.article>
    </div>
  );
}
