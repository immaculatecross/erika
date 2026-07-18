"use client";

import type { TimelineSegment } from "@/lib/ingest-view";
import { SEVERITY_STYLES } from "@/lib/analysis-view";
import { mapFindingsToSegments, trackDenominator, type FindingMarkerInput } from "@/lib/session-map";

// The speech timeline (E-3 part 2 criterion 3) and its session map (E-22 criterion
// 1/2). A horizontal track spanning the whole recording draws each kept speech
// segment as a block at its proportional start/width — silence is the gaps.
// Selecting a block seeks the reused audio player to that segment's start.
//
// Over the track sits the map: one marker per finding at its timestamp, tinted by
// the SHARED SEVERITY_STYLES (E-18, D-14 — red high, orange medium, neutral low;
// green is never a severity). A highlighted marker (its finding selected, or its
// segment selected) reads at full ink with a ring; clicking a marker selects that
// finding and plays its moment. Monochrome track (DESIGN.md): hairline fill, ink
// segments, the selected one accent.

interface Props {
  segments: TimelineSegment[];
  /** Recording length in ms — the track's full width (from the speech summary). */
  totalMs: number;
  selectedIdx: number | null;
  onSelect: (segment: TimelineSegment) => void;
  /** The findings to plot as markers — empty (the default) draws a bare timeline. */
  findings?: FindingMarkerInput[];
  /** Which finding markers read as highlighted (selected, or on the selected segment). */
  highlightedFindingIds?: ReadonlySet<string>;
  /** Select a finding from the map (highlight its segment, play its moment). */
  onSelectFinding?: (id: string) => void;
}

export function SegmentTimeline({
  segments,
  totalMs,
  selectedIdx,
  onSelect,
  findings = [],
  highlightedFindingIds,
  onSelectFinding,
}: Props) {
  const denom = trackDenominator(segments, totalMs);
  const markers = mapFindingsToSegments(segments, findings, totalMs);

  return (
    <div className="flex flex-col gap-2" data-segment-timeline data-total-ms={denom}>
      <div
        className="relative h-10 w-full overflow-hidden rounded-control bg-hairline"
        role="group"
        aria-label="Speech segments across the recording"
      >
        {segments.map((seg) => {
          const left = (seg.startMs / denom) * 100;
          const width = (seg.durationMs / denom) * 100;
          const selected = seg.idx === selectedIdx;
          return (
            <button
              key={seg.idx}
              type="button"
              onClick={() => onSelect(seg)}
              data-segment-idx={seg.idx}
              data-start-ms={seg.startMs}
              data-left={left.toFixed(4)}
              data-width={width.toFixed(4)}
              data-selected={selected}
              aria-label={`Speech segment ${seg.idx + 1}, starts at ${Math.round(seg.startMs / 1000)}s`}
              aria-pressed={selected}
              title={`Segment ${seg.idx + 1}`}
              className={`absolute top-0 h-full rounded-[6px] transition-[opacity,transform] active:scale-[0.98] ${
                selected ? "bg-accent opacity-100" : "bg-ink opacity-30 hover:opacity-50"
              }`}
              style={{ left: `${left}%`, width: `max(2px, ${width}%)` }}
            />
          );
        })}

        {markers.map((m) => {
          const highlighted = highlightedFindingIds?.has(m.id) ?? false;
          const sev = SEVERITY_STYLES[m.severity];
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelectFinding?.(m.id)}
              data-finding-marker
              data-marker-finding-id={m.id}
              data-marker-severity={m.severity}
              data-marker-segment-idx={m.segmentIdx ?? ""}
              data-marker-left={m.leftPercent.toFixed(4)}
              data-selected={highlighted}
              aria-label={`${sev.label}-severity finding at ${Math.round(m.startMs / 1000)}s`}
              aria-pressed={highlighted}
              className={`absolute top-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${sev.dot} ring-card transition-transform active:scale-90 ${
                highlighted ? "scale-125 opacity-100 ring-2" : "opacity-80 ring-1 hover:scale-110 hover:opacity-100"
              }`}
              style={{ left: `${m.leftPercent}%` }}
            />
          );
        })}
      </div>
      <p className="tabular text-[13px] text-secondary">
        {segments.length} {segments.length === 1 ? "segment" : "segments"}
        {markers.length > 0 && (
          <>
            {" · "}
            {markers.length} {markers.length === 1 ? "finding" : "findings"}
          </>
        )}
      </p>
    </div>
  );
}
