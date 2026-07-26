"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square, Check } from "lucide-react";
import { LevelMeter } from "@/components/level-meter";
import { EnrollmentRecorder } from "@/components/placement/enrollment-recorder";
import { useRecorder } from "@/lib/use-recorder";
import { formatElapsed } from "@/lib/recording";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { SpokenOutcome } from "@/lib/onboarding/spoken";

// The spoken half of the assessment (E-46 criteria 3, 10, 11).
//
// TWO takes, deliberately not one, because they carry opposite promises and merging
// them would break the stronger of the two. The prompt take is SENT to the model —
// that is its whole purpose, it is what produces a level from production rather than
// recognition. The enrollment take is stored ON THIS DEVICE and never uploaded
// (D-22), which is what lets Erika tell your voice from a bystander's without any
// of your recordings needing to leave the machine. One recording could not honestly
// be both, so the screen records both and says which is which before either starts.
//
// Both are skippable, and skipping costs the learner nothing but the enrichment:
// the vocabulary check places them on its own (criterion 11). No microphone, a
// denied permission, no API key and simple reluctance all land in the same place —
// "Skip" — and no failure here is dressed as an error.

const CAPTION = "text-[13px] font-medium uppercase tracking-[0.06em] text-secondary";

/** The two questions, asked in one take. Short, concrete, answerable by anyone. */
export const SPOKEN_PROMPTS = [
  "Che cosa hai fatto oggi?  —  What did you do today?",
  "Che cosa ti piace fare nel tempo libero, e perché?  —  What do you like doing in your free time, and why?",
];

/** What the screen says about a spoken outcome. Never dressed up, never a level we
 *  did not get. Exported so the copy is testable without a browser. */
export function spokenOutcomeLine(outcome: SpokenOutcome): string {
  if (outcome.status === "measured") return `Heard. Your speaking sounds like ${outcome.band}.`;
  if (outcome.status === "unusable") {
    return "Erika listened but could not judge that take — it was too short or too quiet. The word check still places you.";
  }
  switch (outcome.reason) {
    case "no-key":
      return "No API key is set, so this take could not be listened to. The word check still places you.";
    case "over-cap":
      return "This month's cap is reached, so this take was not sent. The word check still places you.";
    default:
      return "That take could not be listened to. The word check still places you.";
  }
}

function RecordingDot({ reduced }: { reduced: boolean }) {
  if (reduced) return <span className="h-2 w-2 shrink-0 rounded-full bg-severe" aria-hidden />;
  return (
    <motion.span
      className="h-2 w-2 shrink-0 rounded-full bg-severe"
      animate={{ opacity: [1, 0.35, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    />
  );
}

async function judge(blob: Blob, extension: string, durationMs: number): Promise<SpokenOutcome> {
  try {
    const res = await fetch("/api/onboarding/spoken", {
      method: "POST",
      headers: { "x-audio-format": extension, "x-duration-ms": String(Math.round(durationMs)) },
      body: blob,
    });
    if (!res.ok) return { status: "unavailable", reason: "failed" };
    return (await res.json()) as SpokenOutcome;
  } catch {
    return { status: "unavailable", reason: "failed" };
  }
}

function PromptRecorder({ onJudged }: { onJudged: (o: SpokenOutcome) => void }) {
  const reduced = usePrefersReducedMotion();
  const { status, level, elapsedMs, error, start, stop } = useRecorder();
  const [sending, setSending] = useState(false);

  async function onStop() {
    const take = await stop();
    if (!take) return;
    setSending(true);
    onJudged(await judge(take.blob, take.extension, take.durationMs));
    setSending(false);
  }

  const active = status === "requesting" || status === "recording" || status === "stopping";
  if (active) {
    return (
      <div
        data-spoken-recording
        className="flex w-fit items-center gap-3 rounded-full bg-black/[0.06] px-4 py-2 dark:bg-white/[0.08]"
      >
        <RecordingDot reduced={reduced} />
        <span className="tabular text-[15px] font-medium text-ink" aria-label="Elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <LevelMeter level={level} reduced={reduced} />
        <button
          type="button"
          onClick={onStop}
          disabled={status !== "recording" || sending}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Square size={16} strokeWidth={1.5} aria-hidden />
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        data-spoken-record
        onClick={() => void start()}
        disabled={sending}
        className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
      >
        <Mic size={20} strokeWidth={1.5} aria-hidden />
        {sending ? "Listening…" : "Answer aloud"}
      </button>
      {error && (
        <p className="max-w-xs text-[13px] text-secondary" role="status">
          {error.message} You can skip this step.
        </p>
      )}
    </div>
  );
}

export function SpeakStep({
  onDone,
  submitting,
}: {
  onDone: (spokenBand: string | null) => void;
  submitting: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const [outcome, setOutcome] = useState<SpokenOutcome | null>(null);
  const [enrolled, setEnrolled] = useState(false);
  const band = outcome?.status === "measured" ? outcome.band : null;

  return (
    <motion.div
      data-onboarding-step="speak"
      variants={staggerContainer(reduced)}
      initial="initial"
      animate="animate"
      className="flex flex-col gap-7"
    >
      <motion.header variants={staggerItem(reduced)} className="flex flex-col gap-2">
        <span className={CAPTION}>Two takes, then you are in</span>
        <h1 className="text-[34px] font-bold leading-[1.1] tracking-[-0.022em]">Now say something.</h1>
        <p className="text-[17px] leading-[1.47] text-secondary">
          Knowing a word and being able to use it are different things, so Erika listens to you speak as well. Both
          takes are optional — skip them and the word check places you on its own.
        </p>
      </motion.header>

      <motion.section
        variants={staggerItem(reduced)}
        data-spoken-prompt
        className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card"
      >
        <span className={CAPTION}>Speaking sample · about a minute</span>
        <p className="text-[15px] leading-[1.47] text-secondary">
          Answer these two out loud, in Italian, in one go. Erika listens to this one — it goes to the model, and it
          can raise your level if you speak better than you read.
        </p>
        <ul className="flex flex-col gap-1.5">
          {SPOKEN_PROMPTS.map((p) => (
            <li key={p} className="text-[17px] leading-[1.47] text-ink">
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-1">
          {outcome ? (
            <p
              data-spoken-outcome={outcome.status}
              role="status"
              className={`inline-flex items-center gap-1.5 text-[15px] ${band ? "text-good" : "text-secondary"}`}
            >
              {band && <Check size={16} strokeWidth={1.5} aria-hidden />}
              {spokenOutcomeLine(outcome)}
            </p>
          ) : (
            <PromptRecorder onJudged={setOutcome} />
          )}
        </div>
      </motion.section>

      <motion.section
        variants={staggerItem(reduced)}
        data-enrollment
        className="flex flex-col gap-3 rounded-card bg-card p-6 shadow-card"
      >
        <span className={CAPTION}>Enrollment take · about 45 seconds</span>
        <p className="text-[15px] leading-[1.47] text-secondary">
          Now record 45 seconds of just your voice — read anything, or keep talking. This one stays on this device and
          is never uploaded or analysed. Erika uses it to tell your voice apart from everyone else in the room, so a
          bystander&rsquo;s mistakes never become yours.
        </p>
        <EnrollmentRecorder done={enrolled} onEnrolled={() => setEnrolled(true)} />
      </motion.section>

      <motion.div variants={staggerItem(reduced)} className="flex items-center gap-4">
        <button
          type="button"
          data-onboarding-finish
          onClick={() => onDone(band)}
          disabled={submitting}
          className="inline-flex rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
        >
          {submitting ? "Placing you…" : outcome || enrolled ? "Continue" : "Skip and continue"}
        </button>
      </motion.div>
    </motion.div>
  );
}
