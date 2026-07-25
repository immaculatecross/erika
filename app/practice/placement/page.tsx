"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { Recorder } from "@/components/recorder";
import { VocabCheck } from "@/components/placement/vocab-check";
import { EnrollmentRecorder } from "@/components/placement/enrollment-recorder";
import type { PlacementCheckItem } from "@/lib/placement/check";
import type { PlacementAnswer } from "@/lib/placement/scoring";
import { levelLine, type PlacementResultView } from "@/lib/placement/result-copy";

// Placement onboarding (E-35, D-24). A calm, re-runnable first-run: a rapid yes/no
// vocabulary check (scored model-free, response-style corrected), then two optional
// captures — a short speaking sample that runs through the NORMAL capture→analysis
// path, and a ~45 s enrollment take stored on-device for E-36. One factual line when
// the check lands the level; no confetti, no score theatrics (D-24).
//
// "Re-runnable" is now true rather than aspirational (RETRO-004 §DE-2): a later run
// SUPERSEDES the earlier one, so re-taking the check visibly changes the daily plan.
// That is why a rough result offers "Take the check again" right here — it is the way
// out of a careless placement, and until v0.6 there wasn't one.

type Step = "intro" | "check" | "result";

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";

// [REVIEW-64 F3] The result sentence lives in `lib/placement/result-copy.ts` — pure, exported
// and unit-tested against real route responses (`tests/placement-copy.test.ts`). It was inline
// and unexported here, so restoring the exact pre-PR false sentence kept 994/994 tests green.
// A claim the app makes about the learner deserves the same guard as the writes behind it.

export default function PlacementPage() {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState<Step>("intro");
  const [items, setItems] = useState<PlacementCheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PlacementResultView | null>(null);
  const [sampleRecorded, setSampleRecorded] = useState(false);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/placement")
      .then((r) => r.json())
      .then((body: { check: PlacementCheckItem[] }) => {
        if (alive) setItems(body.check);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // The in-product way out (§DE-2). A re-take supersedes this run: the previous
  // placement's seeded grammar stops counting, so the daily plan actually changes. A
  // FRESH check is fetched so the second run is not the same 64 words.
  async function retake() {
    setResult(null);
    setItems([]);
    setStep("check");
    try {
      const body = (await (await fetch("/api/placement")).json()) as { check: PlacementCheckItem[] };
      setItems(body.check);
    } catch {
      setStep("intro");
    }
  }

  async function submit(answers: PlacementAnswer[]) {
    setLoading(true);
    try {
      const res = await fetch("/api/placement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const body = (await res.json()) as PlacementResultView;
      setResult(body);
    } catch {
      // [REVIEW-64 N5] `submitFailed` rather than a bare level-less result: without it the
      // line fell through to "Placed at the very start. This is a rough placement." — the app
      // reporting a placement it never received. A transport failure is not a measurement.
      setResult({ level: null, calibrated: false, seededWords: 0, seededRules: 0, supersededItems: 0, submitFailed: true });
    } finally {
      setLoading(false);
      setStep("result");
    }
  }

  if (step === "check") {
    if (items.length === 0) {
      return (
        <div className="flex min-h-screen items-center justify-center p-8">
          <p className="text-[15px] text-secondary">Preparing the check…</p>
        </div>
      );
    }
    return <VocabCheck items={items} onDone={submit} />;
  }

  if (step === "result") {
    return (
      <div data-placement-result className="mx-auto max-w-2xl p-8">
        <motion.div variants={staggerContainer(reduced)} initial="initial" animate="animate" className="flex flex-col gap-6">
          <motion.header variants={staggerItem(reduced)}>
            <h1 className="text-[34px] font-bold tracking-tight">Your placement</h1>
            <p data-level-line className="mt-2 text-[17px] text-ink">
              {loading ? "Scoring…" : result ? levelLine(result) : ""}
            </p>
            {!loading && result && !result.calibrated && (
              <button
                type="button"
                data-retake
                onClick={retake}
                className="mt-3 inline-flex rounded-full bg-card px-4 py-2 text-[15px] font-medium text-ink shadow-card transition-transform active:scale-[0.98]"
              >
                Take the check again
              </button>
            )}
          </motion.header>

          {/* Optional speaking sample — the NORMAL capture→analysis path (E-17). */}
          <motion.section variants={staggerItem(reduced)} data-speaking-sample className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card">
            <span className={CAPTION}>Speaking sample — optional</span>
            <p className="text-[15px] text-secondary">
              Speak for a minute about your day or a photo you like. It records like any session and, once Erika has a
              key, is analyzed the same way — nothing separate.
            </p>
            <div>
              {sampleRecorded ? (
                <p className="text-[15px]" style={{ color: "#34C759" }} role="status">
                  Sample captured. It will appear in your sessions.
                </p>
              ) : (
                <Recorder onRecorded={() => setSampleRecorded(true)} />
              )}
            </div>
          </motion.section>

          {/* The ~45 s enrollment take — on-device only (D-22). */}
          <motion.section variants={staggerItem(reduced)} data-enrollment className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card">
            <span className={CAPTION}>Enrollment take</span>
            <p className="text-[15px] text-secondary">
              Record about 45 seconds of just your voice. Erika keeps it on this device to recognize you in future
              recordings — it is never uploaded and never analyzed.
            </p>
            <EnrollmentRecorder done={enrolled} onEnrolled={() => setEnrolled(true)} />
          </motion.section>

          <motion.div variants={staggerItem(reduced)}>
            <Link
              href="/practice"
              data-finish
              className="inline-flex rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
            >
              Go to today
            </Link>
          </motion.div>
        </motion.div>
      </div>
    );
  }

  // intro
  return (
    <div className="mx-auto max-w-2xl p-8">
      <div className="mb-6">
        <Link href="/practice" className="inline-flex items-center gap-1.5 text-[15px] text-secondary transition-colors hover:text-ink">
          <ArrowLeft size={20} strokeWidth={1.5} aria-hidden />
          Today
        </Link>
      </div>
      <motion.div variants={staggerContainer(reduced)} initial="initial" animate="animate" className="flex flex-col gap-6">
        <motion.header variants={staggerItem(reduced)}>
          <h1 className="text-[34px] font-bold tracking-tight">Find your level</h1>
          <p className="mt-2 text-[17px] text-secondary">
            A few minutes of quick yes/no on Italian words tells Erika where to start you — so your daily lessons begin
            near your level, not at the alphabet. Some of the words are invented; say so when one looks made up.
            You can re-take this any time: the most recent run is the one that counts, and it replaces the last one.
          </p>
        </motion.header>
        <motion.div variants={staggerItem(reduced)}>
          <button
            type="button"
            data-begin
            onClick={() => setStep("check")}
            className="inline-flex rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Begin
          </button>
        </motion.div>
      </motion.div>
    </div>
  );
}
