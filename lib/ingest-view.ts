// Client-safe view model for the ingest UI (E-3 part 2). No Node imports live
// here so the detail page, the polling hook, and the read route can all share
// one shape and one set of pure, unit-testable helpers. The server route fills
// this from lib/ingest/pipeline (the job) and lib/segments (the speech), and the
// page renders it — nothing here touches better-sqlite3 or the filesystem.

import type { IngestState } from "./session-types";

/** One speech segment reduced to what the timeline needs (no content hash). */
export interface TimelineSegment {
  idx: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Raw-vs-speech totals with pre-formatted, tabular-friendly labels. */
export interface SpeechSummary {
  rawMs: number;
  speechMs: number;
  segmentCount: number;
  rawLabel: string;
  speechLabel: string;
  /** Speech as a whole-percent of the raw recording (0 when raw is empty). */
  speechPercent: number;
}

/** The whole payload the ingest route returns and the page renders. */
export interface IngestView {
  state: IngestState;
  stage: string | null;
  progress: number;
  error: string | null;
  summary: SpeechSummary;
  segments: TimelineSegment[];
  /**
   * The job is queued or processing but no worker is behind it (E-16b criterion
   * 2) — the state where an upload sat forever under a calm badge because nothing
   * ever said the work happens in a separate `npm run worker` process.
   */
  workerAbsent: boolean;
}

/** Human labels for each pipeline stage (mirrors pipeline.ts STAGES). */
export const STAGE_LABELS: Record<string, string> = {
  normalizing: "Normalizing audio",
  detecting: "Detecting speech",
  segmenting: "Extracting speech",
  rendering: "Preparing renditions",
  done: "Done",
};

/**
 * Milliseconds → a quiet duration label showing the two most significant units:
 * "6h 2m", "47m 3s", "12s". Consistent across the h/m/s boundaries and never
 * cheerleads — DESIGN copy. Negatives and sub-second values collapse to "0s".
 */
export function formatSpan(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/**
 * Pure speech summary: given the kept segments and the raw recording length
 * (seconds, as stored on the session), return the raw and speech totals with
 * their labels and the speech share. rawMs derives from rawSeconds; speechMs is
 * the sum of segment durations. Silence is simply raw − speech.
 */
export function summarizeSpeech(
  segments: readonly { durationMs: number }[],
  rawSeconds: number,
): SpeechSummary {
  const rawMs = Math.max(0, Math.round(rawSeconds * 1000));
  const speechMs = segments.reduce((sum, seg) => sum + Math.max(0, seg.durationMs), 0);
  const speechPercent = rawMs > 0 ? Math.round((speechMs / rawMs) * 100) : 0;
  return {
    rawMs,
    speechMs,
    segmentCount: segments.length,
    rawLabel: formatSpan(rawMs),
    speechLabel: formatSpan(speechMs),
    speechPercent,
  };
}
