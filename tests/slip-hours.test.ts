import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import { buildFocusPayload } from "@/lib/focus";
import { slipHourDistribution, HOURS_IN_DAY } from "@/lib/slip-hours";

// "When you slip" (E-22 criterion 3). The bucketing is pure, so the hour a finding
// lands in is hand-computable, including the empty case (all zero, never NaN) and an
// offset that carries a finding across an hour or midnight boundary. A final DB pass
// proves the Focus payload buckets INCLUDED findings.
//
// [E-38 / RETRO-003] These cases used to pin the UTC hour. The basis is now the
// LEARNER'S LOCAL hour (D-24: the user's day is local; a UTC bucket is not a time
// anyone lived through), so the SAME fixtures are asserted against their local hour
// instead — the coverage is converted, not dropped — and one case per DST transition
// is added, because a local basis has to answer for them (the answer itself is
// documented on `localHour`, lib/local-day.ts). The zone is pinned so every
// expectation stays hand-computable on any machine.

const TZ = "Europe/Rome"; // CET (+1) / CEST (+2) — a real zone with real transitions
const tzBefore = process.env.TZ;
beforeAll(() => {
  process.env.TZ = TZ;
});
afterAll(() => {
  if (tzBefore === undefined) delete process.env.TZ;
  else process.env.TZ = tzBefore;
});

describe("slipHourDistribution — 24 LOCAL buckets, never NaN", () => {
  it("returns 24 zeros with a null peak for no findings", () => {
    const d = slipHourDistribution([]);
    expect(d.buckets).toHaveLength(HOURS_IN_DAY);
    expect(d.buckets.every((n) => n === 0)).toBe(true);
    expect(d.total).toBe(0);
    expect(d.peakHour).toBeNull();
    expect(d.peakCount).toBe(0);
    expect(d.buckets.some((n) => Number.isNaN(n))).toBe(false);
  });

  it("buckets by the LOCAL hour of the session's capture time", () => {
    // The same three fixtures as the UTC version: 08:00Z/08:59:59Z in winter are
    // 09:xx CET, and 21:10Z in June is 23:10 CEST.
    const d = slipHourDistribution([
      { sessionCreatedAt: "2026-01-01 08:00:00", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 08:59:59", startMs: 0 },
      { sessionCreatedAt: "2026-06-02 21:10:00", startMs: 0 },
    ]);
    expect(d.buckets[9]).toBe(2);
    expect(d.buckets[23]).toBe(1);
    expect(d.buckets[8]).toBe(0); // the old UTC answer is no longer the answer
    expect(d.total).toBe(3);
    expect(d.peakHour).toBe(9);
    expect(d.peakCount).toBe(2);
  });

  it("adds the recording offset before reading the hour — an hour boundary", () => {
    // 08:30Z + 45 min of speech = 09:15Z, which is 10:15 CET → hour 10, not 9.
    const d = slipHourDistribution([{ sessionCreatedAt: "2026-01-01 08:30:00", startMs: 45 * 60_000 }]);
    expect(d.buckets[10]).toBe(1);
    expect(d.buckets[9]).toBe(0);
  });

  it("crosses LOCAL midnight correctly via epoch math (the boundary note)", () => {
    // 22:50Z is 23:50 CET; + 20 min → 00:10 the next LOCAL day → hour 0. This is the
    // point of the local basis: the day that rolls over is the learner's, not Greenwich's.
    const d = slipHourDistribution([{ sessionCreatedAt: "2026-01-01 22:50:00", startMs: 20 * 60_000 }]);
    expect(d.buckets[0]).toBe(1);
    expect(d.buckets[23]).toBe(0);
  });

  it("skips an unparseable timestamp rather than corrupting a bucket", () => {
    const d = slipHourDistribution([
      { sessionCreatedAt: "not-a-date", startMs: 0 },
      { sessionCreatedAt: "2026-01-01 03:00:00", startMs: 0 }, // 04:00 CET
    ]);
    expect(d.total).toBe(1);
    expect(d.buckets[4]).toBe(1);
    expect(d.buckets.some((n) => Number.isNaN(n))).toBe(false);
  });
});

describe("slipHourDistribution — the DST answer, asserted (E-38 / RETRO-003)", () => {
  it("SPRING FORWARD: the skipped hour simply gets nothing, and nothing is lost", () => {
    // Europe/Rome 2026-03-29: 01:00Z flips CET→CEST, so local 02:00 never happens.
    const d = slipHourDistribution([
      { sessionCreatedAt: "2026-03-29 00:30:00", startMs: 0 }, // 01:30 CET
      { sessionCreatedAt: "2026-03-29 01:30:00", startMs: 0 }, // 03:30 CEST
    ]);
    expect(d.buckets[1]).toBe(1);
    expect(d.buckets[2]).toBe(0); // the hour that did not exist for the learner
    expect(d.buckets[3]).toBe(1);
    expect(d.total).toBe(2); // Σ conserved: no finding was dropped or misplaced
  });

  it("FALL BACK: the repeated hour is ONE bucket twice as wide — never double-counted", () => {
    // Europe/Rome 2026-10-25: 01:00Z flips CEST→CET, so local 02:00 happens twice.
    const d = slipHourDistribution([
      { sessionCreatedAt: "2026-10-25 00:30:00", startMs: 0 }, // 02:30 CEST (first pass)
      { sessionCreatedAt: "2026-10-25 01:30:00", startMs: 0 }, // 02:30 CET  (second pass)
    ]);
    expect(d.buckets[2]).toBe(2); // both land in hour 2, once each
    expect(d.total).toBe(2); // Σ conserved: nothing counted twice, nothing dropped
  });

  it("conserves Σ(buckets) across a whole DST date (both transitions)", () => {
    for (const date of ["2026-03-29", "2026-10-25"]) {
      const findings = Array.from({ length: 24 }, (_, h) => ({
        sessionCreatedAt: `${date} ${String(h).padStart(2, "0")}:00:00`,
        startMs: 0,
      }));
      const d = slipHourDistribution(findings);
      expect(d.total).toBe(24);
      expect(d.buckets.reduce((s, n) => s + n, 0)).toBe(24);
      expect(d.buckets.some((n) => Number.isNaN(n))).toBe(false);
    }
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

  it("distributes a session's findings by its LOCAL capture hour", () => {
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
    expect(payload.slipHours.buckets[15]).toBe(1); // 14:00Z + 0      → 15:00 CET
    expect(payload.slipHours.buckets[16]).toBe(1); // 14:00Z + 90 min → 16:30 CET
  });
});
