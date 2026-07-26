"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { VocabCheck } from "@/components/placement/vocab-check";
import { RequirementsStep } from "./requirements-step";
import { SpeakStep } from "./speak-step";
import { FIRST_SESSION_PATH } from "@/lib/onboarding/routing";
import type { OnboardingView } from "@/lib/onboarding/requirements";
import type { PlacementCheckItem } from "@/lib/placement/check";
import type { PlacementAnswer } from "@/lib/placement/scoring";
import { levelLine, type PlacementResultView } from "@/lib/placement/result-copy";

// First run (E-46 criteria 1, 2, 3, 5, 9, 11). The only screen a database that has
// never met anybody can reach, and the flow is four steps and no branches:
//
//   needs → check → speak → result → the learner's first session
//
// The last arrow is the point. Onboarding does not end on a congratulations screen
// and does not drop the learner on a home page with a prompt on it; the one action
// on the last step opens the day the assessment just composed. The result step
// survives — rather than redirecting straight through — because criterion 4's
// honesty machinery has to live somewhere: the level, why it might be rough, what
// was written, and the way to retake. It carries no praise, no score and no beat.
//
// The check itself is E-35's, unchanged: same component, same scoring, same
// thresholds. What this milestone adds around it is that you cannot walk past it.

type Step = "needs" | "check" | "speak" | "result";

export function WelcomeFlow({ view }: { view: OnboardingView }) {
  const reduced = usePrefersReducedMotion();
  const router = useRouter();
  const [step, setStep] = useState<Step>("needs");
  const [items, setItems] = useState<PlacementCheckItem[]>([]);
  const [answers, setAnswers] = useState<PlacementAnswer[]>([]);
  const [result, setResult] = useState<PlacementResultView | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/placement")
      .then((r) => r.json())
      .then((body: { check: PlacementCheckItem[] }) => alive && setItems(body.check))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Scoring happens ONCE, after both measurements exist, so one placement run
  // carries the whole assessment. Submitting the check and then re-submitting it
  // with the spoken band would record two runs and make the second supersede the
  // first — correct, but two entries in the learner's history for one sitting.
  async function place(spokenBand: string | null) {
    setSubmitting(true);
    let body: PlacementResultView;
    try {
      const res = await fetch("/api/placement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers, spokenBand }),
      });
      body = (await res.json()) as PlacementResultView;
    } catch {
      body = { level: null, calibrated: false, seededWords: 0, seededRules: 0, supersededItems: 0, submitFailed: true };
    }
    setResult(body);
    setSubmitting(false);
    setStep("result");
  }

  // The marker the routing gate reads. Written before the learner leaves, and
  // written whatever the check concluded — a run refused as unmeasurable records
  // nothing at all, and keying the gate on the placement's writes would hold that
  // learner here forever.
  async function enter() {
    await fetch("/api/onboarding", { method: "POST" }).catch(() => {});
    router.replace(FIRST_SESSION_PATH);
  }

  /** A fresh check, so a retake is not the same 64 words. */
  async function retake() {
    setResult(null);
    setAnswers([]);
    setItems([]);
    setStep("check");
    try {
      const body = (await (await fetch("/api/placement")).json()) as { check: PlacementCheckItem[] };
      setItems(body.check);
    } catch {
      setStep("needs");
    }
  }

  if (step === "check") {
    if (items.length === 0) {
      return (
        <Frame>
          <p className="text-[15px] text-secondary">Preparing the check…</p>
        </Frame>
      );
    }
    return (
      <VocabCheck
        items={items}
        onDone={(a) => {
          setAnswers(a);
          setStep("speak");
        }}
      />
    );
  }

  if (step === "speak") {
    return (
      <Frame>
        <SpeakStep submitting={submitting} onDone={(band) => void place(band)} />
      </Frame>
    );
  }

  if (step === "result") {
    return (
      <Frame>
        <motion.div
          data-onboarding-step="result"
          variants={staggerContainer(reduced)}
          initial="initial"
          animate="animate"
          className="flex flex-col gap-7"
        >
          <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-2">
            <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.022em]">Your level</h1>
            <p data-level-line className="text-[17px] leading-[1.47] text-ink">
              {result ? levelLine(result) : ""}
            </p>
          </motion.header>
          <motion.div variants={staggerItem(reduced)} className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              data-onboarding-enter
              onClick={() => void enter()}
              className="inline-flex rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform hover:opacity-90 active:scale-[0.98]"
            >
              Start today&rsquo;s session
            </button>
            {result && !result.calibrated && (
              <button
                type="button"
                data-retake
                onClick={() => void retake()}
                className="text-[15px] font-medium text-ink underline-offset-4 transition-opacity hover:opacity-70"
              >
                Take the check again
              </button>
            )}
          </motion.div>
        </motion.div>
      </Frame>
    );
  }

  return (
    <Frame>
      <RequirementsStep requirements={view.requirements} onContinue={() => setStep("check")} />
          {/* A learner who already has a profile can reach this screen deliberately —
              from Settings, or by typing the URL — and must always have a way back
              out. The routing gate never redirects them here; this is the other half
              of the same promise. */}
      {view.complete && (
        <p className="mt-8 text-[15px] text-secondary">
          <Link href={FIRST_SESSION_PATH} className="text-ink underline-offset-4 hover:opacity-70">
            Back to Erika
          </Link>{" "}
          — you have already been placed. Going on will re-place you.
        </p>
      )}
    </Frame>
  );
}

/** The onboarding surface has no shell, so it carries its own column. */
function Frame({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8">{children}</div>;
}
