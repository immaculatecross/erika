"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { ListenButton } from "@/components/listen-button";
import { DrillRecorder } from "@/components/drill-recorder";
import { PronunciationResult } from "@/components/pronunciation-result";
import type { DrillGuidance, ResultView } from "@/lib/pronunciation";

// One pronunciation drill (E-37, D-21/D-18/D-24).
//
// THE LOOP IS THE MILESTONE: hear the line pronounced correctly, then say it back,
// then hear yourself. It runs on the EXISTING E-33 phrase render (one TTS vendor, one
// cache, one charge, replayed free) and a local recording — no Azure, no score, no
// extra spend. That is the shipped experience, not a degraded one.
//
// Scoring is an OPTIONAL layer: when the server has an Azure Speech key, a priced
// "Score this take" button appears and returns a per-word/per-sound assessment. When
// it does not, nothing about the loop changes and no wall is shown in its place.
//
// D-18: only the correct target is ever the thing to say — the learner's original
// error never appears. D-24: no streak, no confetti; a score is a fact, quietly told.

interface DrillStatus {
  drillKey: string;
  source: string;
  findingId: string | null;
  referenceText: string;
  explanation: string;
  label: string;
  suspect: string | null;
  guidance: DrillGuidance;
  register: string;
  renditionExists: boolean;
  renditionEstimateUsd: number;
  scoringAvailable: boolean;
  scoreEstimateUsd: number;
  maxSeconds: number;
  unscoredNotice: string;
  notice: string;
}

interface ScoredBody {
  attemptId: string;
  view: ResultView;
}

export default function StudioDrillPage({ params }: { params: Promise<{ drillKey: string }> }) {
  const { drillKey } = use(params);
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState<DrillStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [heard, setHeard] = useState(false);
  const [scored, setScored] = useState<ScoredBody | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/pronunciation/${encodeURIComponent(drillKey)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((s: DrillStatus) => alive && setStatus(s))
      .catch(() => alive && setNotFound(true));
    return () => {
      alive = false;
    };
  }, [drillKey]);

  const onScored = useCallback((body: unknown) => setScored(body as ScoredBody), []);

  const back = (
    <div className="mb-6">
      <Link
        href="/practice/learn/studio"
        className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink"
      >
        <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
        Studio
      </Link>
    </div>
  );

  if (notFound) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        {back}
        <p className="text-[17px] text-secondary">That drill is no longer available.</p>
      </div>
    );
  }
  if (status === null) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-[15px] text-secondary">Preparing the line…</p>
      </div>
    );
  }

  // The native rendition rides on the E-33 shadow endpoints, keyed by finding id. A
  // future producer that is not finding-backed needs its own render route wired the
  // same way (`renderPhrase` over the reference text) — the seam is ready for it.
  const renderUrl = status.findingId ? `/api/shadow/${encodeURIComponent(status.findingId)}` : null;

  return (
    <div className="mx-auto max-w-2xl p-8">
      {back}
      <motion.div variants={staggerContainer(reduced)} initial="initial" animate="animate" className="flex flex-col gap-6">
        <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-1">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">
            Listen, then say it back
          </span>
          <h1 className="text-[34px] font-bold tracking-tight">Studio</h1>
        </motion.header>

        {/* The correct target — headlined (D-18). The error is never shown. */}
        <motion.section
          variants={staggerItem(reduced)}
          data-drill-target
          className="flex flex-col gap-4 rounded-card bg-card p-7 shadow-card"
        >
          <p lang="it" className="text-[22px] font-semibold leading-[1.5] text-ink">
            {status.referenceText}
          </p>
          <p className="text-[15px] text-secondary">{status.explanation}</p>
          <p data-drill-guidance className="text-[15px] text-ink">
            {status.guidance.text}
          </p>
          {renderUrl && (
            <div>
              <ListenButton
                audioSrc={`${renderUrl}/audio`}
                renderUrl={renderUrl}
                exists={status.renditionExists}
                estimateUsd={status.renditionEstimateUsd}
                label="Listen"
                onPlayed={() => setHeard(true)}
              />
            </div>
          )}
        </motion.section>

        {!scored && (
          <motion.section variants={staggerItem(reduced)} data-drill-record className="flex flex-col gap-3">
            <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">Your take</span>
            <DrillRecorder
              scoreUrl={status.scoringAvailable ? `/api/pronunciation/${encodeURIComponent(drillKey)}` : null}
              enabled={heard}
              maxSeconds={status.maxSeconds}
              scoreEstimateUsd={status.scoreEstimateUsd}
              onScored={onScored}
            />
            <p data-drill-unscored-notice className="text-[13px] leading-[1.5] text-secondary">
              {status.scoringAvailable
                ? "Scoring this take is optional — the compare is the practice."
                : status.unscoredNotice}
            </p>
          </motion.section>
        )}

        {scored && (
          <motion.div variants={staggerItem(reduced)}>
            <PronunciationResult
              view={scored.view}
              attemptId={scored.attemptId}
              onRetake={() => {
                setScored(null);
                setHeard(false);
              }}
            />
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
