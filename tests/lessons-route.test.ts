import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// The lesson routes' no-network paths: pattern listing, completion (no model),
// and the guards that fire BEFORE any billable call — unknown pattern (404), bad
// input (400), and the budget cap refusing generation/grading (402). The two
// billable success paths reach the real model and are proven only by the one
// documented smoke, never in CI. Real DB under a throwaway dir.

let patternsGET: typeof import("@/app/api/lessons/patterns/route").GET;
let generatePOST: typeof import("@/app/api/lessons/generate/route").POST;
let gradePOST: typeof import("@/app/api/lessons/grade/route").POST;
let completePOST: typeof import("@/app/api/lessons/complete/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let recordSpend: typeof import("@/lib/analysis/budget").recordSpend;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;

let root: string;

beforeAll(async () => {
  root = tmpDir("erika-lessons-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  patternsGET = (await import("@/app/api/lessons/patterns/route")).GET;
  generatePOST = (await import("@/app/api/lessons/generate/route")).POST;
  gradePOST = (await import("@/app/api/lessons/grade/route")).POST;
  completePOST = (await import("@/app/api/lessons/complete/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  recordSpend = (await import("@/lib/analysis/budget")).recordSpend;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
});

afterEach(() => {
  getDb().prepare("DELETE FROM sessions").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
  getDb().prepare("DELETE FROM lessons").run();
  getDb().prepare("DELETE FROM lesson_mastery").run();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const post = (body: unknown) => new Request("http://localhost", { method: "POST", body: JSON.stringify(body) });

function seedGrammarPattern() {
  createSession(getDb(), { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(getDb(), {
    sessionId: "s1",
    contentHash: "h",
    flagged: true,
    deepDone: true,
    findings: [0, 1, 2].map((i) => ({
      quote: `q${i}`,
      correction: `c${i}`,
      category: "grammar" as const,
      explanation: "e",
      severity: "low" as const,
      startMs: i,
      endMs: i + 1,
    })),
  });
}

describe("GET /api/lessons/patterns", () => {
  it("lists derived patterns with hasLesson and mastery, none below threshold", async () => {
    seedGrammarPattern();
    const body = await (await patternsGET()).json();
    expect(body.threshold).toBe(3);
    expect(body.patterns).toHaveLength(1);
    expect(body.patterns[0]).toMatchObject({ key: "category:grammar", count: 3, hasLesson: false, mastery: 0 });
  });
});

describe("POST /api/lessons/generate — pre-billing guards", () => {
  it("404s an unknown pattern (no model call)", async () => {
    seedGrammarPattern();
    const res = await generatePOST(post({ patternKey: "category:idiom" }));
    expect(res.status).toBe(404);
  });

  it("402s when the shared budget is already reached (refuses before billing)", async () => {
    seedGrammarPattern();
    writeSettings(getDb(), { monthlyBudgetUsd: 0.001 });
    recordSpend(getDb(), { model: "gpt-audio-mini", contentHash: "x", costUsd: 0.001 });
    const res = await generatePOST(post({ patternKey: "category:grammar" }));
    expect(res.status).toBe(402);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM lessons").get() as { n: number };
    expect(n.n).toBe(0); // nothing generated
  });
});

describe("POST /api/lessons/grade — pre-billing guards", () => {
  it("400s on missing fields", async () => {
    const res = await gradePOST(post({ patternKey: "category:grammar", target: "t" }));
    expect(res.status).toBe(400);
  });

  it("402s when the budget is already reached", async () => {
    writeSettings(getDb(), { monthlyBudgetUsd: 0.001 });
    recordSpend(getDb(), { model: "gpt-audio-mini", contentHash: "x", costUsd: 0.001 });
    const res = await gradePOST(post({ patternKey: "category:grammar", target: "I am 25", rewrite: "I have 25" }));
    expect(res.status).toBe(402);
  });
});

describe("POST /api/lessons/complete", () => {
  it("updates mastery for a valid score and rejects an out-of-range one", async () => {
    const ok = await completePOST(post({ patternKey: "category:grammar", score: 1 }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).mastery).toBeCloseTo(0.5, 10);

    const bad = await completePOST(post({ patternKey: "category:grammar", score: 2 }));
    expect(bad.status).toBe(400);
  });
});
