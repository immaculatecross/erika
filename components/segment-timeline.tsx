"use client";

import type { TimelineSegment } from "@/lib/ingest-view";

// The speech timeline (E-3 part 2 criterion 3): a horizontal track spanning the
// whole recording, each kept speech segment drawn as a block at its proportional
// start/width — silence is the gaps between blocks. Selecting a block seeks the
// reused audio player to that segment's start. Monochrome (DESIGN.md): the track
// is a hairline fill, segments are ink, the selected one is the accent.

interface Props {
  segments: TimelineSegment[];
  /** Recording length in ms — the track's full width (from the speech summary). */
  totalMs: number;
  selectedIdx: number | null;
  onSelect: (segment: TimelineSegment) => void;
}

export function SegmentTimeline({ segments, totalMs, selectedIdx, onSelect }: Props) {
  // Never divide by zero, and never let a segment overflow the track if the
  // stored raw duration is slightly short of the last segment's end.
  const lastEnd = segments.reduce((m, s) => Math.max(m, s.endMs), 0);
  const denom = Math.max(totalMs, lastEnd, 1);

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
      </div>
      <p className="tabular text-[13px] text-secondary">
        {segments.length} {segments.length === 1 ? "segment" : "segments"}
      </p>
    </div>
  );
}
