import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import {
  buildFocusModel,
  computeFocus,
  CATEGORY_ORDER,
  type AnalyzedSession,
  type Category,
  type Severity,
} from "@/lib/focus";

// The Focus map metric math (E-7). `computeFocus` is pure, so the acceptance
// criteria are hand-computable: per-category rate over speech-hours (zero, never
// NaN), a chronological trend whose direction reflects a rising/falling rate, and
// a severity-weighted "what to work on next" ranking with a deterministic tie
// break. A final pass drives the real DB accessor to prove only *analyzed*
// sessions count.

const HOUR = 3_600_000;

function fnd(category: Category, severity: Severity = "medium") {
  return { category, severity };
}

function session(over: Partial<AnalyzedSession> = {}): AnalyzedSession {
  return { id: "s", createdAt: "2026-01-01 00:00:00", speechMs: HOUR, findings: [], ...over };
}

function byCat(model: ReturnType<typeof computeFocus>) {
  return Object.fromEntries(model.categories.map((c) => [c.category, c]));
}

describe("computeFocus — per-category rate (criterion 1)", () => {
  it("divides findings by total speech-hours and zero-fills empty categories", () => {
    // Two half-hour sessions = 1.0 analyzed speech-hour. 4 grammar + 2 vocabulary.
    const model = computeFocus([
      session({ id: "a", speechMs: HOUR / 2, findings: [fnd("grammar"), fnd("grammar")] }),
      session({ id: "b", speechMs: HOUR / 2, findings: [fnd("grammar"), fnd("grammar"), fnd("vocabulary"), fnd("vocabulary")] }),
    ]);
    expect(model.speechHours).toBe(1);
    const c = byCat(model);
    expect(c.grammar.ratePerHour).toBe(4); // 4 findings / 1 h
    expect(c.vocabulary.ratePerHour).toBe(2);
    // A category with no findings is present and reads 0 — not absent, not NaN.
    expect(c.phrasing.ratePerHour).toBe(0);
    expect(c.idiom.ratePerHour).toBe(0);
    expect(c.pronunciation.ratePerHour).toBe(0);
    expect(model.categories).toHaveLength(5);
    expect(model.overallRatePerHour).toBe(6);
  });

  it("returns 0 (not NaN) for every rate when there is no speech at all", () => {
    const model = computeFocus([session({ speechMs: 0, findings: [fnd("grammar")] })]);
    expect(model.speechHours).toBe(0);
    for (const c of model.categories) {
      expect(Number.isNaN(c.ratePerHour)).toBe(false);
      expect(c.ratePerHour).toBe(0);
      expect(c.weightedRatePerHour).toBe(0);
    }
    expect(model.overallRatePerHour).toBe(0);
  });
});

describe("[P1] the per-hour rate is gated below the analyzed-speech floor (D-14)", () => {
  it("17 findings over ~2 min is NOT rate-reliable — surfaces show counts, not 450/hr", () => {
    // Two minutes of analyzed speech with 17 findings extrapolates to ~510/hr — the
    // collapsing-denominator artifact the floor exists to suppress (D-20 short-capture norm).
    const twoMinutes = 2 * 60 * 1000;
    const findings = Array.from({ length: 17 }, () => fnd("grammar"));
    const model = computeFocus([session({ speechMs: twoMinutes, findings })]);
    expect(model.totalFindings).toBe(17);
    expect(model.rateReliable).toBe(false); // below MIN_RATE_SPEECH_MINUTES → no rate shown
    // The raw rate is still computed (available to callers) but the UI must not headline it.
    expect(model.overallRatePerHour).toBeGreaterThan(400);
  });

  it("becomes rate-reliable once enough speech accrues (≥ the floor)", () => {
    const sixMinutes = 6 * 60 * 1000;
    const model = computeFocus([session({ speechMs: sixMinutes, findings: [fnd("grammar")] })]);
    expect(model.rateReliable).toBe(true);
  });

  it("an hour of analyzed speech is comfortably rate-reliable", () => {
    expect(computeFocus([session({ findings: [fnd("grammar")] })]).rateReliable).toBe(true);
  });
});

describe("computeFocus — trend across sessions (criterion 2)", () => {
  it("reflects a falling rate as improving, regardless of input order", () => {
    const early = session({ id: "early", createdAt: "2026-01-01 00:00:00", speechMs: HOUR, findings: [fnd("grammar"), fnd("grammar"), fnd("grammar"), fnd("grammar")] });
    const late = session({ id: "late", createdAt: "2026-03-01 00:00:00", speechMs: HOUR, findings: [fnd("grammar")] });
    // Pass the later bucket first — chronological ordering must still hold.
    const model = computeFocus([late, early]);
    expect(model.trend.map((t) => t.sessionId)).toEqual(["early", "late"]);
    expect(model.trend[0].ratePerHour).toBe(4);
    expect(model.trend[1].ratePerHour).toBe(1);
    expect(model.overallTrend).toBe("improving"); // 4/h → 1/h
    expect(byCat(model).grammar.trend).toBe("improving");
  });

  it("reads a rising rate as worsening and a single bucket as flat", () => {
    const a = session({ id: "a", createdAt: "2026-01-01 00:00:00", speechMs: HOUR, findings: [fnd("idiom")] });
    const b = session({ id: "b", createdAt: "2026-02-01 00:00:00", speechMs: HOUR, findings: [fnd("idiom"), fnd("idiom"), fnd("idiom")] });
    expect(computeFocus([a, b]).overallTrend).toBe("worsening");
    expect(computeFocus([a]).overallTrend).toBe("flat");
  });
});

describe("computeFocus — what to work on next (criterion 3)", () => {
  it("ranks by severity-weighted rate, skew first, ties broken by category order", () => {
    // idiom: 2×high = weight 6 → ranks first (skewed).
    // grammar: 3×low = weight 3.  vocabulary: 1×high = weight 3 → tie with grammar.
    const model = computeFocus([
      session({
        speechMs: HOUR,
        findings: [
          fnd("idiom", "high"),
          fnd("idiom", "high"),
          fnd("grammar", "low"),
          fnd("grammar", "low"),
          fnd("grammar", "low"),
          fnd("vocabulary", "high"),
        ],
      }),
    ]);
    const c = byCat(model);
    expect(c.idiom.weightedRatePerHour).toBe(6);
    expect(c.grammar.weightedRatePerHour).toBe(3);
    expect(c.vocabulary.weightedRatePerHour).toBe(3);
    // Skew wins; the 3-vs-3 tie resolves by CATEGORY_ORDER (grammar before vocabulary).
    expect(model.ranking.map((m) => m.category)).toEqual([
      "idiom",
      "grammar",
      "vocabulary",
      "phrasing",
      "pronunciation",
    ]);
    // The ranking is a stable permutation of all five categories.
    expect([...model.ranking].map((m) => m.category).sort()).toEqual([...CATEGORY_ORDER].sort());
  });
});

describe("buildFocusModel — only analyzed sessions count (criterion 4 data path)", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-focus-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  // An un-analysed session is one nothing has listened to: speech extracted, but
  // no `segment_analyses` witness and so no findings. (Before E-17 this seed wrote
  // findings AND a complete witness and then withheld only the job row — a state
  // the cascade cannot produce, since findings are written by a run.)
  function seed(db: Db, id: string, analyzed: boolean) {
    createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
    upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: `${id}-h0` });
    if (!analyzed) return;
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: `${id}-h0`,
      flagged: true,
      deepDone: true,
      findings: [{ quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "high", startMs: 0, endMs: 500 }],
    });
    const job = enqueueAnalysis(db, id);
    db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
  }

  it("is empty over a fresh DB — zero sessions, zero hours, no NaN", () => {
    const model = buildFocusModel(freshDb());
    expect(model.analyzedSessions).toBe(0);
    expect(model.speechHours).toBe(0);
    expect(model.overallRatePerHour).toBe(0);
  });

  it("counts a done-analysis session and ignores one still un-analyzed", () => {
    const db = freshDb();
    seed(db, "done-one", true);
    seed(db, "pending-one", false); // has speech, but nothing has analysed it
    const model = buildFocusModel(db);
    expect(model.analyzedSessions).toBe(1);
    expect(model.speechHours).toBe(1); // only the analyzed session's hour
    expect(byCat(model).grammar.count).toBe(1); // only its finding
  });
});
