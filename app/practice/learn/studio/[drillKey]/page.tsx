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
import { drillGate } from "@/lib/pronunciation/types";
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
  /** Whether this server can render a reference line at all (E-39 §B4). False means no
   *  voice is configured, so "listen first" can never be satisfied here. */
  voiceAvailable: boolean;
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
  // Next hands a PAGE its dynamic params still percent-encoded (unlike a route handler,
  // which receives them decoded). A drill key carries a `:` (`finding:<id>`), so the raw
  // value arrives as `finding%3A<id>` — encoding it again would produce `finding%253A…`
  // and every drill would 404. Decode once here, the same convention as
  // app/practice/lessons/[patternKey]/page.tsx and .../learn/lesson/[itemId]/page.tsx;
  // a drill key never contains a literal `%`, so the decode is always safe.
  const { drillKey: rawDrillKey } = use(params);
  const drillKey = decodeURIComponent(rawDrillKey);
  const reduced = usePrefersReducedMotion();
  const [status, setStatus] = useState<DrillStatus | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [heard, setHeard] = useState(false);
  // The rendition could not be played at all (budget refusal or a failed render). The
  // learner must not be stranded behind a control that cannot succeed, so recording
  // unlocks and the copy says why — they can still record and listen back, which is the
  // larger half of the loop.
  const [renditionUnavailable, setRenditionUnavailable] = useState(false);
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

  // The two decisions, taken together in one pure place (lib/pronunciation/types.ts)
  // because getting their INTERACTION wrong shipped a defect: recording stays unlocked
  // when the rendition cannot play, but a lap the learner never heard the line for must
  // NOT count as a visit — a visit retires the correction permanently, and the
  // comparison against the native rendition IS the drill.
  //
  // [E-39 §B4] `renditionImpossible` is the server's own report that it has no voice at
  // all, which is a different fact from a rendition that failed: it can never succeed, so
  // "listen first" is unsatisfiable here and the reduced loop has to be able to complete —
  // otherwise this finding, which gets no card either, re-enters the plan every day
  // forever. It is read from `status.voiceAvailable`, never inferred from a failed fetch,
  // so a flaky network cannot manufacture a retirement.
  const gate = drillGate({
    heard,
    renditionUnavailable,
    renditionImpossible: status !== null && !status.voiceAvailable,
  });

  const onScored = useCallback((body: unknown) => setScored(body as ScoredBody), []);

  // The learner completed the loop: heard the line, recorded, heard themselves. Record
  // it as a studio VISIT — no score, no money, no upload. This is what lets the composer
  // retire a pronunciation finding on a server with no scorer; without it the finding
  // would re-enter the plan every day forever. Fire-and-forget: a failed POST must never
  // interrupt practice, and the next cycle re-reports it.
  const onCycleComplete = useCallback(() => {
    void fetch(`/api/pronunciation/${encodeURIComponent(drillKey)}/visit`, { method: "POST" }).catch(
      () => {},
    );
  }, [drillKey]);

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
                onPlayed={() => {
                  setHeard(true);
                  // A successful retry makes the "could not be played" notice false —
                  // clear it rather than leave a stale (and now untrue) line on screen.
                  setRenditionUnavailable(false);
                }}
                // The reason is deliberately IGNORED for the retirement decision: that
                // turns on `status.voiceAvailable`, the server's own report, so no
                // client-side failure can manufacture a permanent write (E-39 §B4).
                onUnavailable={() => setRenditionUnavailable(true)}
              />
            </div>
          )}
          {/* [E-39 §B4] Two different facts, two different screens. The old copy said "just
              now" and "stays on your list until you have heard it said correctly" for BOTH,
              which on a server with no voice described a wait that never ends. */}
          {!status.voiceAvailable ? (
            <p data-drill-no-voice className="text-[15px] text-secondary">
              This server has no spoken voice set up, so there is no recording of the line to
              compare against. Read the note above, say the line, and listen back to yourself —
              that is the drill here, and finishing it clears this one from your list.
            </p>
          ) : (
            renditionUnavailable && (
              <p data-drill-rendition-unavailable className="text-[15px] text-secondary">
                The line could not be played. You can still record your take and listen back, but
                this one stays on your list until you have heard it said correctly — comparing is
                the practice, and the voice may work on your next try.
              </p>
            )
          )}
        </motion.section>

        {!scored && (
          <motion.section variants={staggerItem(reduced)} data-drill-record className="flex flex-col gap-3">
            <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">Your take</span>
            <DrillRecorder
              scoreUrl={status.scoringAvailable ? `/api/pronunciation/${encodeURIComponent(drillKey)}` : null}
              enabled={gate.canRecord}
              maxSeconds={status.maxSeconds}
              scoreEstimateUsd={status.scoreEstimateUsd}
              onScored={onScored}
              onCycleComplete={gate.visitCounts ? onCycleComplete : undefined}
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
