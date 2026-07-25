"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square } from "lucide-react";
import { LevelMeter } from "@/components/level-meter";
import { SPRING } from "@/lib/motion";
import { useRecorder, type RecordedTake } from "@/lib/use-recorder";
import { formatElapsed, recordingFilename } from "@/lib/recording";
import { uploadAudio } from "@/lib/upload-audio";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The "Record" affordance on the home screen.
//
// [E-42 criterion 1] ONE CONFIRMATION, THEN NOTHING. Stop no longer uploads behind
// the learner's back: the take is held, its length is stated, and exactly one
// deliberate choice stands between them and a finished analysis — keep it, or throw
// it away. Choosing "Keep" starts everything: upload → ingest → analysis, all by
// itself, with nothing further to press and no price on the screen.
//
// Why a confirmation exists at all, when D-26 says subtract: because the alternative
// is worse in both directions. Auto-uploading every take makes a mis-tap cost real
// money and puts a stranger's voice in the learner's evidence with no way to say no
// before it happens; and a take you cannot discard is a take you must delete
// afterwards, which is more steps, not fewer. One deliberate yes/no at the moment of
// the decision is the smallest honest design — and it is also where the take's
// duration belongs, because "keep this?" is unanswerable without it.
//
// The recording state is this surface's ONE signature moment (DESIGN.md): the level
// meter breathing with the voice. The confirmation that follows is deliberately
// still — a spring-in, then no motion at all, so the eye goes to the decision.

// The recording state's one sanctioned use of red (D-14): a live indicator.
function RecordingDot({ reduced }: { reduced: boolean }) {
  if (reduced) {
    return <span className="h-2 w-2 shrink-0 rounded-full bg-severe" aria-hidden />;
  }
  return (
    <motion.span
      className="h-2 w-2 shrink-0 rounded-full bg-severe"
      animate={{ opacity: [1, 0.35, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      aria-hidden
    />
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; take: RecordedTake }
  | { kind: "saving" };

export function Recorder({
  onRecorded,
  disabled,
  variant = "secondary",
}: {
  /** Called once the kept take has landed — the page refreshes its list and follows it. */
  onRecorded: () => void | Promise<void>;
  disabled?: boolean;
  // [polish] "primary" gives the idle Record button the accent fill — used on the
  // record-first home so Record leads and Upload is the secondary action.
  variant?: "primary" | "secondary";
}) {
  const reduced = usePrefersReducedMotion();
  const { status, level, elapsedMs, error, start, stop } = useRecorder();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [saveError, setSaveError] = useState<string | null>(null);

  async function onStop() {
    const take = await stop();
    if (!take) return; // a lost take already reported itself through `error`
    setSaveError(null);
    setPhase({ kind: "confirm", take });
  }

  async function keep(take: RecordedTake) {
    setPhase({ kind: "saving" });
    setSaveError(null);
    const result = await uploadAudio(recordingFilename(take.extension), take.blob, {
      // When the learner SPOKE (E-42 criterion 5) — the take's start, not this
      // moment. A long take uploaded after the fact is still a take that began when
      // it began, and the whole pipeline dates it from here.
      capturedAt: new Date(take.startedAt).toISOString(),
    });
    setPhase({ kind: "idle" });
    if (result.ok) {
      await onRecorded();
    } else {
      setSaveError(result.message);
    }
  }

  function discard() {
    // Nothing was uploaded and nothing is stored — the blob simply goes out of scope.
    setPhase({ kind: "idle" });
  }

  const active = status === "requesting" || status === "recording" || status === "stopping";

  if (active) {
    return (
      <div
        data-recording
        className="flex items-center gap-3 rounded-full bg-black/[0.06] px-4 py-2 dark:bg-white/[0.08]"
      >
        <RecordingDot reduced={reduced} />
        <span className="tabular text-[15px] font-medium text-ink" aria-label="Elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <LevelMeter level={level} reduced={reduced} />
        <button
          type="button"
          onClick={onStop}
          disabled={status !== "recording"}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Square size={16} strokeWidth={1.5} aria-hidden />
          Stop
        </button>
      </div>
    );
  }

  if (phase.kind === "confirm") {
    const { take } = phase;
    return (
      <motion.div
        data-take-confirm
        className="flex flex-wrap items-center gap-3 rounded-card border border-hairline bg-card p-3"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0.15 } : SPRING}
      >
        <span className="text-[15px] text-ink">
          Keep this take?{" "}
          <span data-take-duration className="tabular text-secondary">
            {formatElapsed(take.durationMs)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void keep(take)}
            data-keep-take
            className="rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Keep
          </button>
          <button
            type="button"
            onClick={discard}
            data-discard-take
            className="rounded-full px-3 py-1.5 text-[15px] font-medium text-secondary transition-colors hover:text-ink"
          >
            Discard
          </button>
        </div>
      </motion.div>
    );
  }

  // A lost take and a failed save both mean audio did NOT land: those get red and
  // an alert role. A denied/unsupported mic is a quiet instruction, not a loss.
  const message = saveError ?? error?.message ?? null;
  const isLoss = saveError !== null || error?.kind === "lost";
  const saving = phase.kind === "saving";

  const idleClass =
    variant === "primary"
      ? "inline-flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
      : "inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]";

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" onClick={() => void start()} disabled={disabled || saving} className={idleClass}>
        <Mic size={20} strokeWidth={1.5} aria-hidden />
        {saving ? "Saving…" : "Record"}
      </button>
      {message && (
        <p
          className={`max-w-xs text-[13px] ${isLoss ? "text-severe" : "text-secondary"}`}
          role={isLoss ? "alert" : "status"}
          data-recorder-message
        >
          {message}
        </p>
      )}
    </div>
  );
}
