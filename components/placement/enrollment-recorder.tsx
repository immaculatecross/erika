"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square, Check } from "lucide-react";
import { LevelMeter } from "@/components/level-meter";
import { useRecorder } from "@/lib/use-recorder";
import { formatElapsed, recordingFilename } from "@/lib/recording";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { AudioFormat } from "@/lib/session-types";

// The enrollment-take recorder (E-35, D-22). Records a clean ~45 s voice sample and
// posts the bytes to /api/placement/enrollment — stored ON-DEVICE ONLY, never
// analyzed as a session. It does NOT use the shared uploadAudio path (that mints a
// session + ingest job); an enrollment take is a voice sample, so it has its own
// endpoint. Re-recordable: recording again replaces the current take.

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

async function postEnrollment(blob: Blob, extension: AudioFormat): Promise<boolean> {
  const res = await fetch("/api/placement/enrollment", {
    method: "POST",
    headers: { "x-filename": encodeURIComponent(recordingFilename(extension)) },
    body: blob,
  });
  return res.ok;
}

export function EnrollmentRecorder({ onEnrolled, done }: { onEnrolled: () => void; done: boolean }) {
  const reduced = usePrefersReducedMotion();
  const { status, level, elapsedMs, error, start, stop } = useRecorder();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function onStop() {
    const take = await stop();
    if (!take) return;
    setSaving(true);
    setSaveError(null);
    const ok = await postEnrollment(take.blob, take.extension);
    setSaving(false);
    if (ok) onEnrolled();
    else setSaveError("The take could not be saved. Try recording again.");
  }

  const active = status === "requesting" || status === "recording" || status === "stopping";

  if (active) {
    return (
      <div data-enrollment-recording className="flex items-center gap-3 rounded-full bg-black/[0.06] px-4 py-2 dark:bg-white/[0.08]">
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

  const message = saveError ?? error?.message ?? null;
  const isLoss = saveError !== null || error?.kind === "lost";

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void start()}
        disabled={saving}
        data-enroll
        className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-5 py-2.5 text-[15px] font-medium text-ink transition-transform hover:bg-black/[0.09] active:scale-[0.98] disabled:opacity-50 dark:bg-white/[0.08] dark:hover:bg-white/[0.12]"
      >
        <Mic size={20} strokeWidth={1.5} aria-hidden />
        {saving ? "Saving…" : done ? "Record again" : "Record enrollment"}
      </button>
      {done && !message && (
        <p data-enrolled className="inline-flex items-center gap-1.5 text-[13px]" style={{ color: "#34C759" }} role="status">
          <Check size={16} strokeWidth={1.5} aria-hidden />
          Take saved. It stays on this device.
        </p>
      )}
      {message && (
        <p className={`max-w-xs text-[13px] ${isLoss ? "text-severe" : "text-secondary"}`} role={isLoss ? "alert" : "status"}>
          {message}
        </p>
      )}
    </div>
  );
}
