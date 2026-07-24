"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { ListenButton } from "@/components/listen-button";
import { Recorder } from "@/components/recorder";

// One listen-and-shadow drill (E-33, D-18/D-21). Hear the CORRECT target phrase
// (rendered through the shared E-21 biller, register-aware), then record a shadow
// take that lands through the NORMAL capture→ingest path — a session like any other.
// No scoring here (D-21: scoring is Azure/E-37 on scripted drills). D-18: only the
// correct target is ever shown — the learner's original error never appears.

interface ShadowStatus {
  findingId: string;
  target: string;
  explanation: string;
  category: string;
  register: string;
  exists: boolean;
  estimateUsd: number;
}

export default function ShadowDrillPage({ params }: { params: Promise<{ findingId: string }> }) {
  const { findingId } = use(params);
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState<ShadowStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [recorded, setRecorded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/shadow/${encodeURIComponent(findingId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((s: ShadowStatus) => alive && setStatus(s))
      .catch(() => alive && setNotFound(true));
    return () => {
      alive = false;
    };
  }, [findingId]);

  const back = (
    <div className="mb-6">
      <Link
        href="/practice/learn/shadow"
        className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Shadow
      </Link>
    </div>
  );

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        {back}
        <p className="text-[17px] text-secondary">That phrase is no longer available.</p>
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Preparing the phrase…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-8">
      {back}
      <motion.div
        variants={staggerContainer(reduced)}
        initial="initial"
        animate="animate"
        className="flex flex-col gap-6"
      >
        <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-1">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Listen and shadow
          </span>
          <h1 className="text-[34px] font-bold tracking-tight">Say it back</h1>
        </motion.header>

        {/* The correct target — headlined (D-18). The error is never shown. */}
        <motion.section
          variants={staggerItem(reduced)}
          data-shadow-target
          className="flex flex-col gap-4 rounded-card bg-card p-7 shadow-card"
        >
          <p lang="it" className="text-[22px] font-semibold leading-[1.5] text-ink">
            {status.target}
          </p>
          <p className="text-[15px] text-secondary">{status.explanation}</p>
          <div>
            <ListenButton
              audioSrc={`/api/shadow/${encodeURIComponent(findingId)}/audio`}
              renderUrl={`/api/shadow/${encodeURIComponent(findingId)}`}
              exists={status.exists}
              estimateUsd={status.estimateUsd}
              label="Listen"
            />
          </div>
        </motion.section>

        {/* Record the shadow take — normal capture→ingest, no scoring here (D-21). */}
        <motion.section variants={staggerItem(reduced)} data-shadow-record className="flex flex-col gap-3">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Your take
          </span>
          <p className="text-[15px] text-secondary">
            Listen, then record yourself saying it. Your take is saved as a session and analyzed like
            any other recording — scoring comes later.
          </p>
          <Recorder onRecorded={() => setRecorded(true)} />
          {recorded && (
            <p data-shadow-recorded className="text-[15px] text-ink">
              Saved. Your take is in{" "}
              <Link href="/" className="underline underline-offset-2">
                Sessions
              </Link>
              .
            </p>
          )}
        </motion.section>
      </motion.div>
    </div>
  );
}
