"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Volume2, Loader2 } from "lucide-react";
import { formatUsd } from "@/lib/format";

// The Compare control (E-21): hear the correction, not just read it. It plays your
// own clip — the segment audio at the finding's timestamp — then Erika's rendition
// of the correction, so the difference is audible. A rendition is generated once
// on demand and cached forever; before it exists the button states the price
// ("Generate — est. $X"), after it exists it plays immediately.
//
// DESIGN.md: the control is the ink accent (black in light, white in dark). No
// green — a rendition that exists is a quiet fact, not a win; the only tones a
// mistake earns are red/orange, and those live on severity, not here. Copy is
// quiet and specific; every state says plainly what it is.

interface Status {
  exists: boolean;
  estimateUsd: number;
  clip: { sessionId: string; startMs: number; endMs: number };
}

type Phase =
  | "loading" // fetching status
  | "missing" // no rendition yet
  | "exists" // rendition cached, ready to compare
  | "generating" // POST in flight
  | "playing-you" // playing the user's own clip
  | "playing-native" // playing the rendition
  | "budget" // monthly cap reached
  | "error"; // model or fetch failure

/** Play `src`; if a window is given, seek to `startSec` and stop at `endSec`. */
function playClip(
  audio: HTMLAudioElement,
  src: string,
  window?: { startSec: number; endSec: number },
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      audio.removeEventListener("timeupdate", onTime);
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
    const onTime = () => {
      if (window && audio.currentTime >= window.endSec) done();
    };
    const start = () => {
      if (window) audio.currentTime = window.startSec;
      void audio.play().catch(onError);
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("ended", done);
    audio.addEventListener("error", onError);
    audio.src = src;
    if (window) {
      audio.addEventListener("loadedmetadata", start, { once: true });
      audio.load();
    } else {
      start();
    }
  });
}

export function CompareControl({ findingId }: { findingId: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState<Status | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof Audio !== "undefined") audioRef.current = new Audio();
    let alive = true;
    fetch(`/api/renditions/${findingId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status failed"))))
      .then((s: Status) => {
        if (!alive) return;
        setStatus(s);
        setPhase(s.exists ? "exists" : "missing");
      })
      .catch(() => alive && setPhase("error"));
    return () => {
      alive = false;
      audioRef.current?.pause();
    };
  }, [findingId]);

  const compare = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !status) return;
    try {
      setPhase("playing-you");
      await playClip(audio, `/api/sessions/${status.clip.sessionId}/audio`, {
        startSec: status.clip.startMs / 1000,
        endSec: status.clip.endMs / 1000,
      });
      setPhase("playing-native");
      await playClip(audio, `/api/renditions/${findingId}/audio`);
      setPhase("exists");
    } catch {
      setPhase("exists");
    }
  }, [findingId, status]);

  const generate = useCallback(async () => {
    setPhase("generating");
    try {
      const res = await fetch(`/api/renditions/${findingId}`, { method: "POST" });
      if (res.status === 402) {
        setPhase("budget");
        return;
      }
      if (!res.ok) {
        setPhase("error");
        return;
      }
      setStatus((s) => (s ? { ...s, exists: true } : s));
      await compare();
    } catch {
      setPhase("error");
    }
  }, [findingId, compare]);

  const playing = phase === "playing-you" || phase === "playing-native";
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div data-compare data-compare-phase={phase} className="flex items-center gap-2" onClick={stop}>
      {phase === "loading" ? (
        <span className="text-[13px] text-secondary">Checking…</span>
      ) : phase === "budget" ? (
        <span data-compare-budget className="text-[13px] text-secondary">
          Monthly budget reached — raise it or wait for the month to roll over.
        </span>
      ) : phase === "error" ? (
        <span data-compare-error className="text-[13px] text-secondary">
          The voice comparison is unavailable right now.
        </span>
      ) : phase === "missing" ? (
        <button
          type="button"
          data-compare-generate
          onClick={generate}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97]"
        >
          <Volume2 size={16} strokeWidth={1.5} aria-hidden />
          Generate — est. {formatUsd(status?.estimateUsd ?? 0)}
        </button>
      ) : phase === "generating" ? (
        <span data-compare-generating className="inline-flex items-center gap-1.5 text-[13px] text-secondary">
          <Loader2 size={16} strokeWidth={1.5} aria-hidden className="animate-spin" />
          Rendering…
        </span>
      ) : (
        <button
          type="button"
          data-compare-play
          disabled={playing}
          onClick={compare}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-ink transition-transform active:scale-[0.97] disabled:opacity-60"
        >
          {playing ? (
            <Volume2 size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <Play size={16} strokeWidth={1.5} aria-hidden />
          )}
          {phase === "playing-you" ? "Playing yours…" : phase === "playing-native" ? "Playing native…" : "Compare"}
        </button>
      )}
    </div>
  );
}
