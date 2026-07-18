import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment, listSegments } from "@/lib/segments";
import { persistSegmentFindings, reuseCachedFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { listSessionFindings } from "@/lib/findings-model";
import type { TimelineSegment } from "@/lib/ingest-view";
import {
  mapFindingsToSegments,
  segmentIdxForMs,
  trackDenominator,
  highlightedFindingIds,
} from "@/lib/session-map";

// The session map's placement math (E-22 criterion 1/2/4). The mapping is pure, so
// which segment a finding sits on and where its marker lands are hand-computable;
// a final DB pass proves a finding remapped by cache reuse (E-16) marks the TARGET
// session's segment, not a donor timestamp (criterion 4).

const seg = (idx: number, startMs: number, endMs: number): TimelineSegment => ({
  idx,
  startMs,
  endMs,
  durationMs: endMs - startMs,
});

describe("segmentIdxForMs — a finding belongs to the segment that contains it", () => {
  const segments = [seg(0, 0, 1000), seg(1, 5000, 6000)];

  it("finds the containing segment and returns null in the silence between", () => {
    expect(segmentIdxForMs(segments, 500)).toBe(0);
    expect(segmentIdxForMs(segments, 5500)).toBe(1);
    expect(segmentIdxForMs(segments, 3000)).toBeNull(); // silence gap
    expect(segmentIdxForMs(segments, 1000)).toBe(0); // inclusive on the boundary
  });
});

describe("mapFindingsToSegments — a marker per finding, tinted by severity", () => {
  const segments = [seg(0, 0, 1000), seg(1, 5000, 6000)];

  it("places each finding on its segment at its proportional offset", () => {
    const markers = mapFindingsToSegments(
      segments,
      [
        { id: "a", startMs: 500, severity: "high" },
        { id: "b", startMs: 5500, severity: "low" },
      ],
      6000,
    );
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ id: "a", segmentIdx: 0, severity: "high" });
    expect(markers[0].leftPercent).toBeCloseTo((500 / 6000) * 100, 6);
    expect(markers[1]).toMatchObject({ id: "b", segmentIdx: 1, severity: "low" });
    expect(markers[1].leftPercent).toBeCloseTo((5500 / 6000) * 100, 6);
  });

  it("clamps a stray offset into the track and never divides by zero", () => {
    expect(trackDenominator([], 0)).toBe(1); // no segments, no raw length
    const [m] = mapFindingsToSegments([seg(0, 0, 1000)], [{ id: "x", startMs: 9_999_999, severity: "medium" }], 1000);
    // denom falls back to the last segment end (1000); the marker clamps to 100%.
    expect(m.leftPercent).toBe(100);
    expect(m.segmentIdx).toBeNull(); // outside every segment → silence, not a crash
  });

  it("maps no findings to an empty marker list — the map stays quiet, not broken", () => {
    expect(mapFindingsToSegments(segments, [], 6000)).toEqual([]);
  });
});

describe("highlightedFindingIds — one selection source for the map and the report", () => {
  const markers = mapFindingsToSegments(
    [seg(0, 0, 1000), seg(1, 5000, 6000)],
    [
      { id: "a", startMs: 200, severity: "high" },
      { id: "b", startMs: 800, severity: "low" },
      { id: "c", startMs: 5500, severity: "medium" },
    ],
    6000,
  );

  it("highlights just the chosen finding when one is selected", () => {
    expect([...highlightedFindingIds(markers, "b", null)]).toEqual(["b"]);
  });

  it("highlights every finding on the chosen segment — the 'vice-versa'", () => {
    expect(highlightedFindingIds(markers, null, 0)).toEqual(new Set(["a", "b"]));
    expect(highlightedFindingIds(markers, null, 1)).toEqual(new Set(["c"]));
  });

  it("highlights nothing when neither is selected", () => {
    expect(highlightedFindingIds(markers, null, null).size).toBe(0);
  });
});

describe("marker placement for a finding remapped by cache reuse (criterion 4)", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-map-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("marks the TARGET session's segment, not the donor's timestamp", () => {
    const db = freshDb();
    const hash = "shared-hash";

    // Donor: the segment sits early (10s) and its finding at 10.5s.
    createSession(db, { id: "donor", originalFilename: "d.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    upsertSegment(db, { sessionId: "donor", idx: 0, startMs: 10_000, endMs: 11_000, contentHash: hash });
    persistSegmentFindings(db, {
      sessionId: "donor",
      contentHash: hash,
      flagged: true,
      deepDone: true,
      findings: [{ quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "high", startMs: 10_500, endMs: 10_700 }],
    });

    // Target: byte-identical audio, but an hour into a different recording.
    createSession(db, { id: "target", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 4000 });
    upsertSegment(db, { sessionId: "target", idx: 0, startMs: 3_600_000, endMs: 3_601_000, contentHash: hash });
    enqueueAnalysis(db, "target");
    reuseCachedFindings(db, "target", hash, { startMs: 3_600_000, endMs: 3_601_000 });

    const findings = listSessionFindings(db, "target");
    expect(findings).toHaveLength(1);
    // The stored offset was remapped onto the target segment (3_600_000 + 500).
    expect(findings[0].startMs).toBe(3_600_500);

    const segments: TimelineSegment[] = listSegments(db, "target").map((s) => ({
      idx: s.idx,
      startMs: s.startMs,
      endMs: s.endMs,
      durationMs: s.durationMs,
    }));
    const [marker] = mapFindingsToSegments(segments, findings.map((f) => ({ id: f.id, startMs: f.startMs, severity: f.severity })), 3_601_000);

    expect(marker.segmentIdx).toBe(0); // the target segment — not silence, not a donor slot
    // The marker sits within the target segment's span, nowhere near the 10.5s donor slot.
    expect(marker.leftPercent).toBeGreaterThan(99);
  });
});
