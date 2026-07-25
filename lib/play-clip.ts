"use client";

// Play an audio clip TO COMPLETION, or reject. Client-safe: no imports, no I/O beyond the
// element it is handed.
//
// WHY THIS IS ITS OWN MODULE [E-39 §B7]. `void audio.play().catch(() => {})` resolves the
// moment playback is REQUESTED, and swallows the failure. `components/drill-recorder.tsx`
// reported a completed practice lap on exactly that — so a take that never made a sound
// still wrote a `pronunciation_visits` row, and that row PERMANENTLY retires the
// correction from the daily plan (lib/compose.ts). The learner heard nothing and lost the
// item. "Said N×" counted button presses.
//
// A promise that settles on `ended` (or rejects on `error`) is the difference between
// "they pressed the button" and "they heard it", and only the second is a fact worth
// writing down. `components/listen-button.tsx` already gated the reference clip this way;
// the learner's own take did not, which is exactly the drift a shared helper prevents.
// (`components/compare-control.tsx` keeps its own variant: it also honours a start/end
// window and pauses at the boundary, a different behaviour rather than a copy of this one.)

/**
 * Play `src` on `audio` and resolve when it FINISHES. Rejects when the element reports an
 * error, or when `play()` is refused (autoplay policy, no output device, unreadable blob).
 */
export function playToEnd(audio: HTMLAudioElement, src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
    const onEnded = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("playback failed"));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    audio.src = src;
    void audio.play().catch(onError);
  });
}
