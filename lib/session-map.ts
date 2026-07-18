import type { Severity } from "./analysis/findings";
import type { TimelineSegment } from "./ingest-view";

// The session map (E-22 criterion 1/2/4): placing each finding as a marker on the
// speech timeline. Pure and client-safe (no Node, no better-sqlite3) so the same
// coordinate math the SegmentTimeline draws with is unit-testable on its own —
// which segment a finding sits on, and where along the track its marker lands.
//
// A finding's `startMs` is an offset on the OWNING session's timeline. When a
// finding was reused from a byte-identical segment in another session (E-16 cache
// reuse), `reuseCachedFindings` already REMAPPED that offset onto this session's
// segment before it was stored — so a plain containment test here places the
// marker on the target session's segment, never on a donor timestamp (criterion 4).

/** One finding reduced to what a marker needs — no quote/correction plumbing. */
export interface FindingMarkerInput {
  id: string;
  startMs: number;
  severity: Severity;
}

/** A finding placed on the track: which segment it belongs to, and where it sits. */
export interface FindingMarker {
  id: string;
  severity: Severity;
  startMs: number;
  /** The segment whose bounds contain `startMs`, or null when it lands in silence. */
  segmentIdx: number | null;
  /** Horizontal position as a percent of the track width (0..100). */
  leftPercent: number;
}

/**
 * The track's full width in ms — the SAME denominator the SegmentTimeline uses so
 * a marker and its segment share one coordinate system: never divide by zero, and
 * never let a marker overflow the track if the stored raw duration falls a hair
 * short of the last segment's end.
 */
export function trackDenominator(segments: readonly TimelineSegment[], totalMs: number): number {
  const lastEnd = segments.reduce((m, s) => Math.max(m, s.endMs), 0);
  return Math.max(totalMs, lastEnd, 1);
}

/**
 * Which segment an absolute offset sits on, or null if it falls in the silence
 * between segments. Segments are non-overlapping kept-speech intervals; a first
 * match wins on the (measure-zero) case of an offset exactly on a shared boundary.
 */
export function segmentIdxForMs(segments: readonly TimelineSegment[], startMs: number): number | null {
  for (const s of segments) {
    if (startMs >= s.startMs && startMs <= s.endMs) return s.idx;
  }
  return null;
}

/**
 * Place every finding on the track: its owning segment (by containment) and its
 * marker's left offset, clamped into the track so a stray timestamp can never
 * render outside it. Because reused findings are stored already remapped onto this
 * session's segment, the marker lands on the target segment (criterion 4).
 */
export function mapFindingsToSegments(
  segments: readonly TimelineSegment[],
  findings: readonly FindingMarkerInput[],
  totalMs: number,
): FindingMarker[] {
  const denom = trackDenominator(segments, totalMs);
  return findings.map((f) => ({
    id: f.id,
    severity: f.severity,
    startMs: f.startMs,
    segmentIdx: segmentIdxForMs(segments, f.startMs),
    leftPercent: (Math.min(Math.max(f.startMs, 0), denom) / denom) * 100,
  }));
}

/**
 * The set of finding ids to highlight, driving both the map's markers and the
 * report's rows from one source so the two never disagree. Selecting a single
 * finding highlights it alone; selecting a segment (no finding chosen) highlights
 * every finding on that segment — the "and vice-versa" of criterion 2.
 */
export function highlightedFindingIds(
  markers: readonly FindingMarker[],
  selectedFindingId: string | null,
  selectedSegmentIdx: number | null,
): Set<string> {
  if (selectedFindingId !== null) return new Set([selectedFindingId]);
  if (selectedSegmentIdx !== null) {
    return new Set(markers.filter((m) => m.segmentIdx === selectedSegmentIdx).map((m) => m.id));
  }
  return new Set<string>();
}
