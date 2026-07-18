import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { buildFocusPayload } from "@/lib/focus";
import { slipHourDistribution, HOURS_IN_DAY } from "@/lib/slip-hours";

// "When you slip" (E-22 criterion 3). The bucketing is pure and UTC-based, so the
// hour a finding lands in is hand-computable, including the empty case (all zero,
// never NaN) and an offset that carries a finding across an hour or midnight
// boundary. A final DB pass proves the Focus payload buckets INCLUDED findings.

describe("slipHourDistribution — 24 UTC buckets, never NaN", () => {
  it("returns 24 zeros with a null peak for no findings", () => {
    const d = slipHourDistribution([]);
    expect(d.buckets).toHaveLength(HOURS_IN_DAY);
    expect(d.buckets.every((n) => n === 0)).toBe(true);
    expect(d.total).toBe(0);
    expect(d.peakHour).toBeNull();
    expect(d.peakCount).toBe(0);
    expect(d.buckets.some((n) => Number.isNaN(n))).toBe(false);
  });

  it("buckets by the UTC hour of the session's capture time", () => {
    const d = slipHourDistribution([
      { sessionCreatedAt: "2026-01-01 08:00:00", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 08:59:59", startMs: 0 },
      { sessionCreatedAt: "2026-06-02 21:10:00", startMs: 0 },
    ]);
    expect(d.buckets[8]).toBe(2);
    expect(d.buckets[21]).toBe(1);
    expect(d.total).toBe(3);
    expect(d.peakHour).toBe(8);
    expect(d.peakCount).toBe(2);
  });

  it("adds the recording offset before reading the hour — an hour boundary", () => {
    // 08:30 + 45 min of speech lands the slip at 09:15 → hour 9, not 8.
    const d = slipHourDistribution([{ sessionCreatedAt: "2026-01-01 08:30:00", startMs: 45 * 60_000 }]);
    expect(d.buckets[9]).toBe(1);
    expect(d.buckets[8]).toBe(0);
  });

  it("crosses midnight correctly via epoch math (the boundary note)", () => {
    // 23:50 + 20 min → 00:10 the next day → hour 0.
    const d = slipHourDistribution([{ sessionCreatedAt: "2026-01-01 23:50:00", startMs: 20 * 60_000 }]);
    expect(d.buckets[0]).toBe(1);
    expect(d.buckets[23]).toBe(0);
  });

  it("skips an unparseable timestamp rather than corrupting a bucket", () => {
    const d = slipHourDistribution([
      { sessionCreatedAt: "not-a-date", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 03:00:00", startMs: 0 },
    ]);
    expect(d.total).toBe(1);
    expect(d.buckets[3]).toBe(1);
    expect(d.buckets.some((n) => Number.isNaN(n))).toBe(false);
  });
});

describe("buildFocusPayload — buckets the included findings (data path)", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-slip-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("distributes a session's findings by its capture hour", () => {
    const db = freshDb();
    createSession(db, { id: "s1", originalFilename: "s.wav", format: "wav", sizeBytes: 1, durationSeconds: 3600 });
    db.prepare("UPDATE sessions SET created_at = '2026-01-01 14:00:00' WHERE id = 's1'").run();
    upsertSegment(db, { sessionId: "s1", idx: 0, startMs: 0, endMs: 3_600_000, contentHash: "s1-h" });
    persistSegmentFindings(db, {
      sessionId: "s1",
      contentHash: "s1-h",
      flagged: true,
      deepDone: true,
      findings: [
        { quote: "q1", correction: "c1", category: "grammar", explanation: "e", severity: "high", startMs: 0, endMs: 500 },
        { quote: "q2", correction: "c2", category: "vocabulary", explanation: "e", severity: "low", startMs: 90 * 60_000, endMs: 90 * 60_000 + 500 },
      ],
    });
    const job = enqueueAnalysis(db, "s1");
    db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);

    const payload = buildFocusPayload(db);
    expect(payload.slipHours.total).toBe(2);
    expect(payload.slipHours.buckets[14]).toBe(1); // 14:00 + 0
    expect(payload.slipHours.buckets[15]).toBe(1); // 14:00 + 90 min → 15:30
  });
});
