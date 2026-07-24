import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { Db } from "@/lib/db";

// E-18 route surfaces, driven end to end against a throwaway DB:
//   * GET /api/sessions serves each session WITH its yield (criterion 2);
//   * GET /api/settings reports month-to-date spend from spend_ledger (criterion 4);
//   * GET /api/lessons/patterns prices an ungenerated lesson (criterion 5);
//   * POST /api/letter/viewed records the letter as opened; GET /api/letter does
//     not (the read/write split of E-24, closing E-18's read-that-wrote);
//   * GET /api/plan serves the composed daily plan (criterion 1).
// Env points the DB at the throwaway dir before any getDb(); route modules are
// imported after that in beforeAll. No network, no model calls.

let root: string;
let db: Db;
let GET_SESSIONS: typeof import("@/app/api/sessions/route").GET;
let GET_SETTINGS: typeof import("@/app/api/settings/route").GET;
let GET_PATTERNS: typeof import("@/app/api/lessons/patterns/route").GET;
let GET_LETTER: typeof import("@/app/api/letter/route").GET;
let VIEWED_POST: typeof import("@/app/api/letter/viewed/route").POST;
let GET_PLAN: typeof import("@/app/api/plan/route").GET;

const HOUR = 3_600_000;
const WEEK = "2026-07-13"; // a Monday

beforeAll(async () => {
  root = tmpDir("erika-home-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  GET_SESSIONS = (await import("@/app/api/sessions/route")).GET;
  GET_SETTINGS = (await import("@/app/api/settings/route")).GET;
  GET_PATTERNS = (await import("@/app/api/lessons/patterns/route")).GET;
  GET_LETTER = (await import("@/app/api/letter/route")).GET;
  VIEWED_POST = (await import("@/app/api/letter/viewed/route")).POST;
  GET_PLAN = (await import("@/app/api/plan/route")).GET;
  db = (await import("@/lib/db")).getDb();

  // One analysed session with 3 grammar findings (a qualifying pattern), one
  // never-analysed session with speech — the two rows the list must tell apart.
  const { createSession } = await import("@/lib/sessions");
  const { upsertSegment } = await import("@/lib/segments");
  const { persistSegmentFindings } = await import("@/lib/analysis/findings");
  const { enqueueAnalysis } = await import("@/lib/analysis/cascade");

  for (const id of ["analysed", "raw"] as const) {
    createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
    db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${WEEK} 09:00:00`, id);
    db.prepare("UPDATE ingest_jobs SET state = 'done' WHERE session_id = ?").run(id);
    upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: `${id}-h0` });
  }
  persistSegmentFindings(db, {
    sessionId: "analysed",
    contentHash: "analysed-h0",
    flagged: true,
    deepDone: true,
    findings: Array.from({ length: 3 }, (_, i) => ({
      quote: `q${i}`,
      correction: `c${i}`,
      category: "grammar" as const,
      explanation: "why",
      severity: "high" as const,
      startMs: i * 1000,
      endMs: i * 1000 + 500,
    })),
  });
  const job = enqueueAnalysis(db, "analysed");
  db.prepare("UPDATE analysis_jobs SET state = 'done', progress = 1 WHERE id = ?").run(job.id);
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("GET /api/sessions — yield on every row (criterion 2)", () => {
  it("tells an analysed session's yield apart from a raw one", async () => {
    const rows = (await (await GET_SESSIONS()).json()) as {
      id: string;
      analysed: boolean;
      segmentCount: number;
      sessionYield: { analysedSpeechMs: number; findingsCount: number; dominantCategory: string } | null;
    }[];
    const analysed = rows.find((r) => r.id === "analysed")!;
    const raw = rows.find((r) => r.id === "raw")!;
    expect(analysed.analysed).toBe(true);
    expect(analysed.sessionYield).toEqual({
      analysedSpeechMs: HOUR,
      findingsCount: 3,
      dominantCategory: "grammar",
    });
    expect(raw.analysed).toBe(false);
    expect(raw.sessionYield).toBeNull();
    expect(raw.segmentCount).toBe(1);
  });
});

describe("GET /api/settings — month-to-date spend (criterion 4)", () => {
  it("reports real spend_ledger money against the cap, display only", async () => {
    const { recordSpend } = await import("@/lib/analysis/budget");
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "analysed-h0", costUsd: 1.25 });
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "analysed-h0", costUsd: 0.5 });

    const body = (await (await GET_SETTINGS()).json()) as { monthlyBudgetUsd: number; spentThisMonth: number };
    expect(body.spentThisMonth).toBeCloseTo(1.75, 10);
    expect(body.monthlyBudgetUsd).toBe(50); // E-28 default cap (25 → 50, D-20); display only
  });
});

describe("GET /api/lessons/patterns — lesson ready vs priced (criterion 5)", () => {
  it("prices an ungenerated lesson with the existing estimate machinery, then null once generated", async () => {
    const before = (await (await GET_PATTERNS()).json()) as {
      patterns: { key: string; hasLesson: boolean; estimateUsd: number | null }[];
    };
    const grammar = before.patterns.find((p) => p.key === "category:grammar")!;
    expect(grammar.hasLesson).toBe(false);
    expect(grammar.estimateUsd).toBeGreaterThan(0);

    const { insertLesson } = await import("@/lib/lessons/lessons");
    insertLesson(db, "category:grammar", {
      explanation: "short",
      exercises: [{ type: "fill_in", prompt: "p", answer: "a" }],
    });
    const after = (await (await GET_PATTERNS()).json()) as {
      patterns: { key: string; hasLesson: boolean; estimateUsd: number | null }[];
    };
    const ready = after.patterns.find((p) => p.key === "category:grammar")!;
    expect(ready.hasLesson).toBe(true);
    expect(ready.estimateUsd).toBeNull();
  });
});

describe("the plan and the letter-viewed marker (criterion 1)", () => {
  it("the plan carries the unread letter through a GET, and clears only on POST viewed", async () => {
    const before = (await (await GET_PLAN()).json()) as { letterWeek: string; letterUnread: boolean };
    expect(before.letterWeek).toBe(WEEK);
    expect(before.letterUnread).toBe(true);

    // A GET serves the letter but must NOT mark it read (E-24 read/write split).
    const res = await GET_LETTER(new Request("http://localhost/api/letter"));
    const { letter } = (await res.json()) as { letter: { weekStart: string } };
    expect(letter.weekStart).toBe(WEEK);
    const stillUnread = (await (await GET_PLAN()).json()) as { letterUnread: boolean };
    expect(stillUnread.letterUnread).toBe(true);

    // The explicit POST is what flips it — as the screen fires after rendering.
    await VIEWED_POST(
      new Request("http://localhost/api/letter/viewed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ week: WEEK }),
      }),
    );
    const after = (await (await GET_PLAN()).json()) as { letterUnread: boolean };
    expect(after.letterUnread).toBe(false);
  });

  it("prescribes the qualifying pattern with its price", async () => {
    const plan = (await (await GET_PLAN()).json()) as {
      dueCount: number;
      lesson: { category: string; count: number; ready: boolean; estimateUsd: number | null };
    };
    expect(plan.lesson.category).toBe("grammar");
    expect(plan.lesson.count).toBe(3);
    expect(plan.lesson.ready).toBe(true); // generated in the patterns test above
    expect(plan.lesson.estimateUsd).toBeNull();
  });
});
