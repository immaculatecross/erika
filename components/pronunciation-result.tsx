"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Volume2 } from "lucide-react";
import { staggerContainer, staggerItem } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import type { ResultView, ScoreBand, WordCell } from "@/lib/pronunciation";

// The feedback for one scored take (E-37). A word strip coloured by accuracy, tap a
// word to open its phonemes, tap again to hear your own rendering of exactly that
// word — the offset/duration ticks Azure returns are a free forced alignment of the
// learner's audio, so a word slice is a seek into their own take, not a second file.
//
// DESIGN: semantic colour only (D-14) — green means mastery, red means high severity,
// amber the middle; the score itself is the one accented number, tabular. No
// gamification, no confetti, no celebratory beat (D-24). The uncalibrated line sits
// under the scores, plainly, always.
//
// D-18: the correct target is what leads. A phoneme note names what was produced only
// to say what was expected — the learner is never asked to imitate their own error.
// There is NO intonation or rhythm score anywhere here: it-IT returns none.

const BAND_TEXT: Record<ScoreBand, string> = {
  good: "text-good",
  shaky: "text-medium",
  off: "text-severe",
};

const BAND_FILL: Record<ScoreBand, string> = {
  good: "bg-good/10",
  shaky: "bg-medium/10",
  off: "bg-severe/10",
};

function ScoreLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-[15px] text-secondary">{label}</span>
      <span className="tabular text-[15px] text-ink">{Math.round(value)}</span>
    </div>
  );
}

function WordButton({
  cell,
  open,
  onToggle,
  onPlay,
}: {
  cell: WordCell;
  open: boolean;
  onToggle: () => void;
  onPlay: () => void;
}) {
  const omitted = cell.errorType === "Omission";
  return (
    <button
      type="button"
      data-word
      data-band={cell.band}
      data-error-type={cell.errorType}
      aria-expanded={open}
      onClick={onToggle}
      onDoubleClick={cell.playable ? onPlay : undefined}
      className={`rounded-control px-2.5 py-1.5 text-[17px] transition-transform active:scale-[0.98] ${BAND_FILL[cell.band]} ${BAND_TEXT[cell.band]} ${omitted ? "line-through opacity-70" : ""}`}
      lang="it"
    >
      {cell.word}
    </button>
  );
}

export function PronunciationResult({
  view,
  attemptId,
  onRetake,
}: {
  view: ResultView;
  /** The stored take, streamed for word-slice playback. */
  attemptId: string;
  onRetake: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [openWord, setOpenWord] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopAt = useRef<number | null>(null);

  useEffect(() => {
    if (typeof Audio === "undefined") return;
    const audio = new Audio(`/api/pronunciation/attempts/${encodeURIComponent(attemptId)}/audio`);
    const onTime = () => {
      if (stopAt.current !== null && audio.currentTime >= stopAt.current) {
        audio.pause();
        stopAt.current = null;
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audioRef.current = audio;
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.pause();
    };
  }, [attemptId]);

  /** Play exactly [startMs, startMs+durationMs) of the learner's own take. */
  const playSlice = useCallback((startMs: number, durationMs: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    stopAt.current = (startMs + durationMs) / 1000;
    audio.currentTime = startMs / 1000;
    void audio.play().catch(() => {
      stopAt.current = null;
    });
  }, []);

  // Too noisy to score: no numbers at all, one calm line, one action.
  if (view.retake || !view.scores) {
    return (
      <section data-pron-retake className="flex flex-col gap-4 rounded-card bg-card p-7 shadow-card">
        <p className="text-[17px] text-ink">{view.retakeNotice}</p>
        <div>
          <button
            type="button"
            onClick={onRetake}
            className="rounded-full bg-accent px-4 py-2 text-[15px] font-medium text-accent-ink transition-transform active:scale-[0.98]"
          >
            Record again
          </button>
        </div>
      </section>
    );
  }

  const s = view.scores;
  return (
    <motion.section
      variants={staggerContainer(reduced)}
      initial="initial"
      animate="animate"
      data-pron-result
      className="flex flex-col gap-6"
    >
      <motion.div variants={staggerItem(reduced)} className="flex flex-col gap-4 rounded-card bg-card p-7 shadow-card">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">This take</span>
          <span data-pron-score className={`tabular text-[34px] font-bold tracking-tight ${BAND_TEXT[s.band]}`}>
            {Math.round(s.pronScore)}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <ScoreLine label="Sounds" value={s.accuracyScore} />
          <ScoreLine label="Flow" value={s.fluencyScore} />
          <ScoreLine label="Said in full" value={s.completenessScore} />
        </div>
        <p data-pron-notice className="text-[13px] leading-[1.5] text-secondary">
          {view.notice}
        </p>
      </motion.div>

      <motion.div variants={staggerItem(reduced)} className="flex flex-col gap-3">
        <span className="text-[13px] font-medium uppercase tracking-[0.06em] text-secondary">Word by word</span>
        <div data-word-strip className="flex flex-wrap gap-1.5">
          {view.words.map((w, i) => (
            <WordButton
              key={`${w.word}-${i}`}
              cell={w}
              open={openWord === i}
              onToggle={() => setOpenWord(openWord === i ? null : i)}
              onPlay={() => playSlice(w.startMs, w.durationMs)}
            />
          ))}
        </div>
        <p className="text-[13px] text-secondary">Tap a word for its sounds; tap Hear to play your own.</p>
      </motion.div>

      {openWord !== null && view.words[openWord] && (
        <motion.div
          variants={staggerItem(reduced)}
          initial="initial"
          animate="animate"
          data-word-detail
          className="flex flex-col gap-4 rounded-card bg-card p-7 shadow-card"
        >
          <div className="flex items-center justify-between gap-4">
            <span lang="it" className="text-[22px] font-semibold text-ink">
              {view.words[openWord].word}
            </span>
            {view.words[openWord].playable && (
              <button
                type="button"
                data-play-word
                onClick={() => playSlice(view.words[openWord]!.startMs, view.words[openWord]!.durationMs)}
                className="inline-flex items-center gap-1.5 rounded-full bg-black/[0.06] px-3.5 py-1.5 text-[15px] text-ink transition-transform active:scale-[0.98] dark:bg-white/[0.08]"
              >
                <Volume2 size={18} strokeWidth={1.5} aria-hidden />
                Hear yours
              </button>
            )}
          </div>
          {view.words[openWord].errorType === "Omission" ? (
            <p className="text-[15px] text-secondary">You skipped this word. Say the whole line next time.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {view.words[openWord].phonemes.map((p, j) => (
                <li key={`${p.phoneme}-${j}`} data-phoneme data-band={p.band} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <span className={`text-[17px] ${BAND_TEXT[p.band]}`}>/{p.phoneme}/</span>
                    <span className="tabular text-[13px] text-secondary">{Math.round(p.accuracyScore)}</span>
                  </span>
                  {p.note && (
                    <span data-phoneme-note className="text-[15px] text-secondary">
                      {p.note}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}

      <motion.div variants={staggerItem(reduced)}>
        <button
          type="button"
          data-pron-again
          onClick={onRetake}
          className="rounded-full bg-black/[0.06] px-4 py-2 text-[15px] font-medium text-ink transition-transform active:scale-[0.98] dark:bg-white/[0.08]"
        >
          Try it again
        </button>
      </motion.div>
    </motion.section>
  );
}
