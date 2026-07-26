"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Volume2, Loader2 } from "lucide-react";
import { formatEstimate } from "@/lib/format";
import { NoticeLine } from "@/components/session/step-notice";
import { noticeFor, type NoticeReason } from "@/lib/session/notices";

// A listen control for a rendered phrase (E-33), shared by the shadow drill and the
// reading surface. It plays a cached TTS render of a CORRECT phrase; before the
// render exists it states the price ("Listen — est. $X") and generates once on
// demand through the shared E-21 biller (reserve-before-call, cached, ledgered),
// then plays. After it exists it plays immediately. DESIGN.md: the ink accent, no
// green — a render is a quiet fact, not a win; budget/error states are plain lines.

type Phase = "idle" | "generating" | "playing" | "blocked";

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
  onPlayed,
  onUnavailable,
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
  /** Fired when a clip has finished playing. The pronunciation studio (E-37) uses it
   *  to unlock recording only AFTER the reference has been heard — Azure cannot assess
   *  two voices in one take, so listening and recording must be sequential. */
  onPlayed?: () => void;
  /** Fired when the clip cannot be played at all (budget refusal or a failed render).
   *  A surface that gates on `onPlayed` uses this to stop gating and say so honestly,
   *  rather than leaving the learner stuck behind a control that cannot succeed. */
  onUnavailable?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  // [v0.7 close sweep] WHY it cannot play, as the server classified it. This component
  // used to hold two hand-written strings — "Monthly budget reached — raise it or wait
  // for the month to roll over." beside a retry that could not clear the cap, and "The
  // voice is unavailable right now." for a missing key, which is permanent. It no
  // longer decides: the route names the condition and the shared table decides the
  // wording, the link and whether a retry is honest.
  const [notice, setNotice] = useState<NoticeReason | null>(null);
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
      onPlayed?.();
    } catch {
      // Playback of a clip that already exists failed — genuinely momentary.
      setNotice("voice-transient");
      setPhase("blocked");
      onUnavailable?.();
    }
  }, [audioSrc, onPlayed, onUnavailable]);

  const generateAndPlay = useCallback(async () => {
    setPhase("generating");
    try {
      const res = await fetch(renderUrl, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { notice?: NoticeReason } | null;
        setNotice(body?.notice ?? "voice-transient");
        setPhase("blocked");
        onUnavailable?.();
        return;
      }
      setReady(true);
      await play();
    } catch {
      setNotice("voice-transient");
      setPhase("blocked");
      onUnavailable?.();
    }
  }, [renderUrl, play, onUnavailable]);

  // A failed or refused render must never become a dead end — and, since the v0.7
  // gate, must not pretend either. The notice carries the way forward: a link where
  // one helps, a retry ONLY where retrying can change the outcome (so the cap and a
  // missing key no longer offer one — the earlier version did, on both). Every state
  // still notifies the surface through `onUnavailable` so a screen gating on `onPlayed`
  // (the E-37 studio) stops gating.
  if (phase === "blocked" && notice) {
    return (
      <NoticeLine
        reason={notice}
        testId="listen"
        onRetry={noticeFor(notice).retryable ? () => void (ready ? play() : generateAndPlay()) : undefined}
      />
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
