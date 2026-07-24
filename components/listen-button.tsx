"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Volume2, Loader2 } from "lucide-react";
import { formatEstimate } from "@/lib/format";

// A listen control for a rendered phrase (E-33), shared by the shadow drill and the
// reading surface. It plays a cached TTS render of a CORRECT phrase; before the
// render exists it states the price ("Listen — est. $X") and generates once on
// demand through the shared E-21 biller (reserve-before-call, cached, ledgered),
// then plays. After it exists it plays immediately. DESIGN.md: the ink accent, no
// green — a render is a quiet fact, not a win; budget/error states are plain lines.

type Phase = "idle" | "generating" | "playing" | "budget" | "error";

/** Play `src` to completion (or rejection). Mirrors the Compare control's helper. */
function playClip(audio: HTMLAudioElement, src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("ended", done);
      audio.removeEventListener("error", onError);
      audio.pause();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      reject(new Error("playback failed"));
    };
    audio.addEventListener("ended", done);
    audio.addEventListener("error", onError);
    audio.src = src;
    void audio.play().catch(onError);
  });
}

export function ListenButton({
  audioSrc,
  renderUrl,
  exists,
  estimateUsd,
  label = "Listen",
}: {
  /** GET route streaming the rendered clip. */
  audioSrc: string;
  /** POST route that renders the phrase (idempotent, cached). */
  renderUrl: string;
  /** Whether a render already exists (from the surface's status fetch). */
  exists: boolean;
  /** Worst-case render cost, shown before the render exists. */
  estimateUsd: number;
  label?: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(exists);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof Audio !== "undefined") audioRef.current = new Audio();
    const audio = audioRef.current;
    return () => audio?.pause();
  }, []);
  useEffect(() => setReady(exists), [exists]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      setPhase("playing");
      await playClip(audio, audioSrc);
      setPhase("idle");
    } catch {
      setPhase("error");
    }
  }, [audioSrc]);

  const generateAndPlay = useCallback(async () => {
    setPhase("generating");
    try {
      const res = await fetch(renderUrl, { method: "POST" });
      if (res.status === 402) {
        setPhase("budget");
        return;
      }
      if (!res.ok) {
        setPhase("error");
        return;
      }
      setReady(true);
      await play();
    } catch {
      setPhase("error");
    }
  }, [renderUrl, play]);

  if (phase === "budget") {
    return (
      <span data-listen-budget className="text-[13px] text-secondary">
        Monthly budget reached — raise it or wait for the month to roll over.
      </span>
    );
  }
  if (phase === "error") {
    return (
      <span data-listen-error className="text-[13px] text-secondary">
        The voice is unavailable right now.
      </span>
    );
  }
  if (phase === "generating") {
    return (
      <span data-listen-generating className="inline-flex items-center gap-1.5 text-[13px] text-secondary">
        <Loader2 size={16} strokeWidth={1.5} aria-hidden className="animate-spin" />
        Rendering…
      </span>
    );
  }

  return (
    <button
      type="button"
      data-listen
      disabled={phase === "playing"}
      onClick={ready ? play : generateAndPlay}
      className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-60"
    >
      {phase === "playing" ? (
        <Volume2 size={18} strokeWidth={1.5} aria-hidden />
      ) : (
        <Play size={18} strokeWidth={1.5} aria-hidden />
      )}
      {phase === "playing" ? "Playing…" : ready ? label : `${label} — est. ${formatEstimate(estimateUsd)}`}
    </button>
  );
}
