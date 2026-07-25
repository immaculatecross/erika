"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMotionValue, type MotionValue } from "framer-motion";
import {
  assembleChunks,
  levelFromAnalyser,
  pickRecordingMime,
  TAKE_LOST_MESSAGE,
  takeOutcome,
  toUploadableWav,
} from "./recording";
import type { AudioFormat } from "./session-types";

// A thin state machine over MediaRecorder + a Web Audio AnalyserNode. The pure
// logic (level, mime pick, chunk assembly) lives in ./recording; this hook owns
// only the browser objects and their lifecycle. `level` is a MotionValue so the
// meter can spring to it at 60fps without a React re-render every frame; the
// elapsed clock ticks a few times a second, which is all a seconds display needs.

export type RecorderStatus = "idle" | "requesting" | "recording" | "stopping";

export interface RecorderError {
  // 'denied' — the mic was blocked; 'unsupported' — no MediaRecorder/getUserMedia;
  // 'lost' — the take was recorded but could not be decoded/encoded for upload.
  kind: "denied" | "unsupported" | "lost";
  message: string;
}

export interface RecordedTake {
  blob: Blob;
  extension: AudioFormat;
  /**
   * Wall-clock instant the take STARTED (epoch ms) — when the learner began
   * speaking, which is the authoritative source for `sessions.captured_at`
   * (E-42 criterion 5). Taken with `Date.now()` at `start()`, deliberately NOT from
   * the `performance.now()` clock the elapsed timer uses: that one is monotonic but
   * has no calendar, and a calendar is exactly what this value is for.
   */
  startedAt: number;
  /** How long the take ran, in ms — what the keep/discard confirmation states. */
  durationMs: number;
}

export interface Recorder {
  status: RecorderStatus;
  level: MotionValue<number>;
  elapsedMs: number;
  error: RecorderError | null;
  start: () => Promise<void>;
  stop: () => Promise<RecordedTake | null>;
}

// One chunk per second: a long take is flushed in pieces and survives even if
// the tab is killed mid-recording, rather than riding on one fragile buffer.
const TIMESLICE_MS = 1000;

// The container→WAV conversion is shared with the tutor (lib/recording.ts).

export function useRecorder(): Recorder {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [error, setError] = useState<RecorderError | null>(null);
  const level = useMotionValue(0);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("");
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);
  const startedAtEpochRef = useRef<number>(0);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    level.set(0);
  }, [level]);

  // Release the mic and audio graph if we unmount mid-recording.
  useEffect(() => cleanup, [cleanup]);

  const start = useCallback(async () => {
    setError(null);
    const mimeType = pickRecordingMime();
    const supported =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== "undefined" &&
      typeof AudioContext !== "undefined";
    if (!supported || !mimeType) {
      setError({
        kind: "unsupported",
        message: "Recording is not supported in this browser. Upload a file instead.",
      });
      return;
    }

    setStatus("requesting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setStatus("idle");
      setError({
        kind: "denied",
        message: "Microphone access is off. Allow it in your browser to record, or upload a file.",
      });
      return;
    }

    streamRef.current = stream;
    mimeRef.current = mimeType;
    chunksRef.current = [];

    // Analyser on the live stream is the real signal behind the meter.
    const ctx = new AudioContext();
    audioCtxRef.current = ctx;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    ctx.createMediaStreamSource(stream).connect(analyser);
    analyserRef.current = analyser;

    const buffer = new Uint8Array(analyser.fftSize);
    const sample = () => {
      const node = analyserRef.current;
      if (!node) return;
      node.getByteTimeDomainData(buffer);
      level.set(levelFromAnalyser(buffer));
      rafRef.current = requestAnimationFrame(sample);
    };
    rafRef.current = requestAnimationFrame(sample);

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start(TIMESLICE_MS);

    startedAtRef.current = performance.now();
    startedAtEpochRef.current = Date.now();
    setElapsedMs(0);
    timerRef.current = setInterval(() => {
      setElapsedMs(performance.now() - startedAtRef.current);
    }, 200);

    setStatus("recording");
  }, [level]);

  const stop = useCallback((): Promise<RecordedTake | null> => {
    const recorder = recorderRef.current;
    if (!recorder || status !== "recording") return Promise.resolve(null);
    setStatus("stopping");
    return new Promise<RecordedTake | null>((resolve) => {
      recorder.onstop = async () => {
        // The final partial chunk has already fired before onstop, so this
        // assembles the complete, ordered take across every timeslice boundary.
        const recorded = assembleChunks(chunksRef.current, mimeRef.current);
        // The live container has no duration ffprobe can read, so decode it and
        // re-encode to WAV, whose header states an exact, probeable length.
        const wav = recorded.size > 0 ? await toUploadableWav(recorded).catch(() => null) : null;
        const durationMs = Math.max(0, performance.now() - startedAtRef.current);
        const { take, lost } = takeOutcome(wav, startedAtEpochRef.current, durationMs);
        cleanup();
        setStatus("idle");
        setElapsedMs(0);
        // A take that cannot be encoded is GONE. Saying so is the whole point:
        // resolving null silently returned the UI to idle and the person never
        // learned their recording had been discarded (E-16b criterion 6).
        if (lost) setError({ kind: "lost", message: TAKE_LOST_MESSAGE });
        resolve(take);
      };
      recorder.stop();
    });
  }, [status, cleanup]);

  return { status, level, elapsedMs, error, start, stop };
}
