// Pure, framework-free helpers for mic capture (E-2 part 2). Kept out of React
// and out of the MediaRecorder wiring so every branch is unit-testable in Node:
// elapsed formatting, level-from-analyser, chunk assembly, and picking a
// supported MediaRecorder mime + matching upload extension. No DOM state here.

import { formatDuration } from "./format";
import { SUPPORTED_FORMATS, type AudioFormat } from "./session-types";

/**
 * Monotonic elapsed time (milliseconds) → "m:ss" (or "h:mm:ss" past an hour),
 * for tabular-numeral display. Seconds are floored so the timer reads the whole
 * second in progress, never rounds up early. Reuses the list's duration format.
 */
export function formatElapsed(elapsedMs: number): string {
  return formatDuration(Math.floor(Math.max(0, elapsedMs) / 1000));
}

/**
 * Instantaneous input level in [0, 1] from an AnalyserNode's byte time-domain
 * buffer (values 0–255, 128 = silence). Computes RMS of the centred signal:
 * a flat-128 (silent) buffer yields 0, a full-scale buffer approaches 1. This
 * is the real signal that drives the live meter — not a fake animation.
 */
export function levelFromAnalyser(timeDomain: Uint8Array): number {
  if (timeDomain.length === 0) return 0;
  let sumSquares = 0;
  for (let i = 0; i < timeDomain.length; i++) {
    const centred = (timeDomain[i] - 128) / 128;
    sumSquares += centred * centred;
  }
  const rms = Math.sqrt(sumSquares / timeDomain.length);
  return rms > 1 ? 1 : rms;
}

/**
 * Assemble the ordered MediaRecorder chunks into one Blob. The final file is the
 * concatenation of every `dataavailable` slice in arrival order — so a long take
 * flushed in pieces reassembles complete, not truncated to the last chunk.
 */
export function assembleChunks(chunks: Blob[], mimeType: string): Blob {
  return new Blob(chunks, { type: mimeType });
}

// The capture container, in preference order: Opus-in-WebM (Chromium/Firefox)
// first, then MP4/AAC (Safari). What MediaRecorder emits is decoded and
// re-encoded to WAV before upload (see UPLOAD_FORMAT / encodeWav), because a
// live MediaRecorder stream carries no container duration and the server probes
// duration with ffprobe. So this only has to name a container the browser can
// record and later decode — the on-disk format is always WAV.
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/mpeg",
];

/** The format every mic take is normalized to before upload (probeable duration). */
export const UPLOAD_FORMAT: AudioFormat = "wav";

/**
 * The first MediaRecorder mime this browser supports, or null when MediaRecorder
 * is unavailable or supports none of them. Guards the global so the module stays
 * importable in Node (tests) and during SSR.
 */
export function pickRecordingMime(): string | null {
  const Recorder = typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined;
  if (!Recorder || typeof Recorder.isTypeSupported !== "function") return null;
  return MIME_CANDIDATES.find((mime) => Recorder.isTypeSupported(mime)) ?? null;
}

/**
 * Encode decoded PCM (one Float32Array per channel, samples in [-1, 1]) into a
 * 16-bit little-endian WAV Blob. WAV states its sample count in the header, so
 * ffprobe reads an exact duration (samples ÷ sampleRate) — unlike a live WebM.
 * Pure and framework-free: unit-tested for header fields and byte length.
 */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const numChannels = Math.max(1, channels.length);
  const numFrames = channels[0]?.length ?? 0;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // byte rate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true); // bits per sample
  writeStr(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < numFrames; frame++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][frame];
      sample = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * A filename for a mic take, e.g. "recording-2026-07-17T18-30-00.webm". The
 * timestamp is filesystem-safe (colons → dashes) and the extension is one the
 * ingestion endpoint accepts.
 */
export function recordingFilename(extension: AudioFormat, at: Date = new Date()): string {
  const stamp = at.toISOString().slice(0, 19).replace(/:/g, "-");
  const ext = (SUPPORTED_FORMATS as readonly string[]).includes(extension)
    ? extension
    : "webm";
  return `recording-${stamp}.${ext}`;
}
