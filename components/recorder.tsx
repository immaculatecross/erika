"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square } from "lucide-react";
import { LevelMeter } from "@/components/level-meter";
import { useRecorder } from "@/lib/use-recorder";
import { formatElapsed, recordingFilename } from "@/lib/recording";
import { uploadAudio } from "@/lib/upload-audio";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The "Record" affordance beside Upload on the Sessions screen. Idle: a quiet
// neutral button. Recording: a pill with a live red dot, an elapsed timer in
// tabular numerals, and the level meter breathing with the voice. On Stop the
// chunks assemble and POST to the same ingestion endpoint the upload flow uses
// (lib/upload-audio), so the take lands in the list with a queued job. A denied
// or unsupported mic renders a quiet, specific line — never a dead control.

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

export function Recorder({
  onRecorded,
  disabled,
}: {
  onRecorded: () => void | Promise<void>;
  disabled?: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const { status, level, elapsedMs, error, start, stop } = useRecorder();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function onStop() {
    const take = await stop();
    if (!take) return;
    setSaving(true);
    setSaveError(null);
    const result = await uploadAudio(recordingFilename(take.extension), take.blob);
    setSaving(false);
    if (result.ok) {
      await onRecorded();
    } else {
      setSaveError(result.message);
    }
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
          disabled={status !== "recording" || saving}
          className="ml-1 inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          <Square size={16} strokeWidth={1.5} aria-hidden />
          Stop
        </button>
      </div>
    );
  }

  // A lost take and a failed save both mean audio did NOT land: those get red and
  // an alert role. A denied/unsupported mic is a quiet instruction, not a loss.
  const message = saveError ?? error?.message ?? null;
  const isLoss = saveError !== null || error?.kind === "lost";

  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void start()}
        disabled={disabled || saving}
        className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
      >
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
