"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square, Volume2 } from "lucide-react";
import { LevelMeter } from "@/components/level-meter";
import { useRecorder } from "@/lib/use-recorder";
import { formatElapsed } from "@/lib/recording";
import { formatEstimate } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";

// The drill recorder (E-37). The take does NOT become a session: it stays in the page,
// where its whole job is the loop that matters — hear the correct line, say it back,
// hear yourself, go again.
//
// THAT LOOP NEEDS NO SERVER AND NO KEY. Playback of your own take is a local object
// URL; nothing is uploaded, nothing is stored, nothing is billed. Scoring is an
// OPTIONAL extra step: when a scorer is configured, a priced button offers to send
// this one take for a per-word assessment. When it is not, the loop is unchanged and
// complete — the studio never presents "no key" as the experience.
//
// SEQUENTIAL BY CONSTRUCTION (vendor limitation, OBS-002, and plain sense): the
// reference must not be audible while you record — a scorer cannot assess two voices,
// and shadowing over the model teaches you to hear the model instead of yourself. The
// record button stays locked until the rendition has finished playing once.

// The recording state's one sanctioned use of red (D-14): a live indicator.
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

const PILL =
  "inline-flex w-fit items-center gap-1.5 rounded-full px-4 py-2 text-[15px] font-medium transition-transform active:scale-[0.98] disabled:opacity-40";

export function DrillRecorder({
  scoreUrl,
  enabled,
  maxSeconds,
  scoreEstimateUsd,
  onScored,
}: {
  /** The optional scoring route. Null when no scorer is configured — the loop is
   *  unchanged and no scoring control is offered. */
  scoreUrl: string | null;
  /** False until the native rendition has been heard (sequential, never simultaneous). */
  enabled: boolean;
  maxSeconds: number;
  scoreEstimateUsd: number;
  onScored: (body: unknown) => void;
}) {
  const reduced = usePrefersReducedMotion();
  const { status, level, elapsedMs, error, start, stop } = useRecorder();
  const [take, setTake] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof Audio !== "undefined") playerRef.current = new Audio();
    const audio = playerRef.current;
    return () => audio?.pause();
  }, []);

  // Revoke the previous object URL whenever the take is replaced or the page leaves.
  useEffect(() => {
    return () => {
      if (take) URL.revokeObjectURL(take.url);
    };
  }, [take]);

  const onStop = useCallback(async () => {
    const recorded = await stop();
    if (!recorded) return;
    setFailure(null);
    setTake((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { blob: recorded.blob, url: URL.createObjectURL(recorded.blob) };
    });
  }, [stop]);

  const playMine = useCallback(() => {
    const audio = playerRef.current;
    if (!audio || !take) return;
    audio.src = take.url;
    void audio.play().catch(() => {});
  }, [take]);

  const sendForScore = useCallback(async () => {
    if (!scoreUrl || !take) return;
    setSending(true);
    setFailure(null);
    try {
      const res = await fetch(scoreUrl, {
        method: "POST",
        headers: { "content-type": "audio/wav" },
        body: take.blob,
      });
      const body = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setFailure(body?.error?.message ?? "That take could not be scored.");
        return;
      }
      onScored(body);
    } catch {
      setFailure("That take could not be sent for scoring.");
    } finally {
      setSending(false);
    }
  }, [scoreUrl, take, onScored]);

  const active = status === "requesting" || status === "recording" || status === "stopping";
  const overLong = elapsedMs / 1000 > maxSeconds;

  if (active) {
    return (
      <div
        data-drill-recording
        className="flex flex-wrap items-center gap-3 rounded-full bg-black/[0.06] px-4 py-2 dark:bg-white/[0.08]"
      >
        <RecordingDot reduced={reduced} />
        <span className="tabular text-[15px] font-medium text-ink" aria-label="Elapsed">
          {formatElapsed(elapsedMs)}
        </span>
        <LevelMeter level={level} reduced={reduced} />
        <button
          type="button"
          onClick={() => void onStop()}
          disabled={status !== "recording"}
          className={`${PILL} bg-accent text-accent-ink`}
        >
          <Square size={16} strokeWidth={1.5} aria-hidden />
          Stop
        </button>
        {overLong && scoreUrl && (
          <span data-drill-too-long className="text-[13px] text-secondary">
            Over {maxSeconds}s — stop now if you want this take scored.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-drill-record
          disabled={!enabled}
          onClick={() => void start()}
          className={`${PILL} bg-accent text-accent-ink`}
        >
          <Mic size={18} strokeWidth={1.5} aria-hidden />
          {take ? "Record again" : "Record your take"}
        </button>
        {take && (
          <button
            type="button"
            data-drill-play-mine
            onClick={playMine}
            className={`${PILL} bg-black/[0.06] text-ink dark:bg-white/[0.08]`}
          >
            <Volume2 size={18} strokeWidth={1.5} aria-hidden />
            Hear yours
          </button>
        )}
        {take && scoreUrl && (
          <button
            type="button"
            data-drill-score
            disabled={sending}
            onClick={() => void sendForScore()}
            className={`${PILL} bg-black/[0.06] text-ink dark:bg-white/[0.08]`}
          >
            {sending ? "Scoring…" : `Score this take — est. ${formatEstimate(scoreEstimateUsd)}`}
          </button>
        )}
      </div>

      {!enabled && (
        <span data-drill-listen-first className="text-[13px] text-secondary">
          Play the line first — never record while the rendition is audible. Headphones help.
        </span>
      )}
      {take && (
        <span data-drill-compare className="text-[13px] text-secondary">
          Play the line, then yours, and listen for the difference.
        </span>
      )}
      {error && (
        <span data-drill-mic-error className="text-[13px] text-secondary">
          {error.message}
        </span>
      )}
      {failure && (
        <span data-drill-error className="text-[13px] text-secondary">
          {failure}
        </span>
      )}
    </div>
  );
}
