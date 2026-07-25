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

/**
 * What the server said went wrong, when it said anything (E-39 §B3). `null` means the
 * failure was local (playback died in the browser) — transient by construction.
 */
type Failure = { message: string; retryable: boolean } | null;

/**
 * Why the reference clip could not be played, for a surface that gates on having heard it.
 * `"not-configured"` is PERMANENT on this server; the other two may succeed later.
 */
export type RenditionUnavailableReason = "not-configured" | "budget" | "unavailable";

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
  /** Fired when the clip cannot be played at all. A surface that gates on `onPlayed` uses
   *  this to stop gating and say so honestly, rather than leaving the learner stuck behind
   *  a control that cannot succeed.
   *
   *  [E-39 §B3/§B4] It now carries WHY, because the two cases are not the same fact and
   *  the studio's retirement rule turns on the difference: `"not-configured"` means this
   *  server can never render the line (permanent — no retry can help), while
   *  `"budget"`/`"unavailable"` mean a later attempt genuinely might. */
  onUnavailable?: (reason: RenditionUnavailableReason) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ready, setReady] = useState(exists);
  const [failure, setFailure] = useState<Failure>(null);
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
      setFailure(null);
      onPlayed?.();
    } catch {
      // Local playback failure: nothing was asked of the server, so it is transient.
      setFailure(null);
      setPhase("error");
      onUnavailable?.("unavailable");
    }
  }, [audioSrc, onPlayed, onUnavailable]);

  const generateAndPlay = useCallback(async () => {
    setPhase("generating");
    try {
      const res = await fetch(renderUrl, { method: "POST" });
      if (res.status === 402) {
        setFailure(null);
        setPhase("budget");
        onUnavailable?.("budget");
        return;
      }
      if (!res.ok) {
        // [E-39 §B3] The server says which failure this is. A missing key is permanent,
        // so the copy must not say "right now" and no retry may be offered for it.
        const body = (await res.json().catch(() => ({}))) as { error?: string; retryable?: boolean };
        const retryable = body.retryable ?? true;
        setFailure(body.error ? { message: body.error, retryable } : null);
        setPhase("error");
        onUnavailable?.(retryable ? "unavailable" : "not-configured");
        return;
      }
      setReady(true);
      setFailure(null);
      await play();
    } catch {
      setFailure(null);
      setPhase("error");
      onUnavailable?.("unavailable");
    }
  }, [renderUrl, play, onUnavailable]);

  // A failed or refused render must never become a dead end. Both states keep a retry
  // control — the earlier version rendered a bare line and REMOVED the button, so a
  // surface that gates on `onPlayed` (the E-37 studio) could be stranded with no way
  // forward — and both notify the surface through `onUnavailable` so it can unlock
  // whatever it was gating on having heard the clip.
  if (phase === "budget") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span data-listen-budget className="text-[13px] text-secondary">
          Monthly budget reached — raise it or wait for the month to roll over.
        </span>
        <button
          type="button"
          data-listen-retry
          onClick={() => void generateAndPlay()}
          className="text-[13px] font-medium text-ink underline underline-offset-2"
        >
          Try again
        </button>
      </span>
    );
  }
  if (phase === "error") {
    // [E-39 §B3] This said "The voice is unavailable right now." for every failure,
    // including a server with no key configured — where it is false and the "Try again"
    // beside it could never succeed. The server's own sentence is shown when it sent one,
    // and the retry appears only when a retry can honestly help.
    const retryable = failure === null || failure.retryable;
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span data-listen-error className="text-[13px] text-secondary">
          {failure?.message ?? "The voice could not be played. This is usually temporary."}
        </span>
        {retryable && (
          <button
            type="button"
            data-listen-retry
            onClick={() => void (ready ? play() : generateAndPlay())}
            className="text-[13px] font-medium text-ink underline underline-offset-2"
          >
            Try again
          </button>
        )}
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
