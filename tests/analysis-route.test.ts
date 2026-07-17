import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// The two analysis routes. GET estimate prices the pending segments and reports
// budget headroom; POST re-checks the budget server-side and enqueues a run —
// refusing (402) when the month's cap is already reached. Real DB under a
// throwaway dir; env is set before the lazy getDb() binds.

let root: string;
let estimateGET: typeof import("@/app/api/sessions/[id]/analysis/estimate/route").GET;
let reportGET: typeof import("@/app/api/sessions/[id]/analysis/route").GET;
let startPOST: typeof import("@/app/api/sessions/[id]/analysis/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let upsertSegment: typeof import("@/lib/segments").upsertSegment;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let recordSpend: typeof import("@/lib/analysis/budget").recordSpend;
let enqueueAnalysis: typeof import("@/lib/analysis/cascade").enqueueAnalysis;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;

beforeAll(async () => {
  root = tmpDir("erika-analysis-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  estimateGET = (await import("@/app/api/sessions/[id]/analysis/estimate/route")).GET;
  reportGET = (await import("@/app/api/sessions/[id]/analysis/route")).GET;
  startPOST = (await import("@/app/api/sessions/[id]/analysis/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  upsertSegment = (await import("@/lib/segments")).upsertSegment;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  recordSpend = (await import("@/lib/analysis/budget")).recordSpend;
  enqueueAnalysis = (await import("@/lib/analysis/cascade")).enqueueAnalysis;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
});

afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost");

function seed(id: string) {
  createSession(getDb(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 600 });
  upsertSegment(getDb(), { sessionId: id, idx: 0, startMs: 0, endMs: 60_000, contentHash: `${id}-h0` });
}

describe("GET analysis estimate", () => {
  it("404s for an unknown session", async () => {
    expect((await estimateGET(req(), ctx("nope"))).status).toBe(404);
  });

  it("returns a positive estimate and budget headroom for pending segments", async () => {
    seed("est");
    const body = await (await estimateGET(req(), ctx("est"))).json();
    expect(body.estimate.pendingCount).toBe(1);
    expect(body.estimate.totalUsd).toBeGreaterThan(0);
    expect(body.budgetUsd).toBe(25);
    expect(body.remainingUsd).toBeGreaterThan(0);
  });
});

describe("POST start analysis", () => {
  it("enqueues a queued job (202) when budget allows", async () => {
    seed("go");
    const res = await startPOST(req(), ctx("go"));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.job.state).toBe("queued");
    // A second POST reuses the in-flight job rather than duplicating it.
    await startPOST(req(), ctx("go"));
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE session_id='go'").get() as { n: number };
    expect(n.n).toBe(1);
  });

  it("refuses (402) once the month's budget is already reached", async () => {
    seed("broke");
    writeSettings(getDb(), { monthlyBudgetUsd: 1 });
    recordSpend(getDb(), { model: "gpt-audio-1.5", contentHash: "x", costUsd: 1 });
    const res = await startPOST(req(), ctx("broke"));
    expect(res.status).toBe(402);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM analysis_jobs WHERE session_id='broke'").get() as { n: number };
    expect(n.n).toBe(0); // nothing enqueued
  });
});

describe("GET analysis report", () => {
  it("404s for an unknown session", async () => {
    expect((await reportGET(req(), ctx("nope"))).status).toBe(404);
  });

  it("reports 'idle' with no findings before any run", async () => {
    seed("fresh");
    const body = await (await reportGET(req(), ctx("fresh"))).json();
    expect(body.state).toBe("idle");
    expect(body.total).toBe(0);
    expect(body.findings).toEqual([]);
    expect(body.counts).toHaveLength(5); // all five categories, zero-filled
    expect(body.counts.every((c: { count: number }) => c.count === 0)).toBe(true);
  });

  it("returns the run state, findings, and per-category counts once analyzed", async () => {
    seed("rep");
    upsertSegment(getDb(), { sessionId: "rep", idx: 1, startMs: 60_000, endMs: 120_000, contentHash: "rep-h1" });
    const job = enqueueAnalysis(getDb(), "rep");
    getDb().prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
    persistSegmentFindings(getDb(), {
      sessionId: "rep",
      contentHash: "rep-h1",
      flagged: true,
      deepDone: true,
      findings: [
        { quote: "q1", correction: "c1", category: "grammar", explanation: "e1", severity: "high", startMs: 61_000, endMs: 62_000 },
        { quote: "q2", correction: "c2", category: "grammar", explanation: "e2", severity: "low", startMs: 63_000, endMs: 64_000 },
      ],
    });

    const body = await (await reportGET(req(), ctx("rep"))).json();
    expect(body.state).toBe("done");
    expect(body.total).toBe(2);
    expect(body.findings).toHaveLength(2);
    const byCat = Object.fromEntries(body.counts.map((c: { category: string; count: number }) => [c.category, c.count]));
    expect(byCat.grammar).toBe(2);
    expect(byCat.vocabulary).toBe(0);
    expect(body.findings[0]).toMatchObject({ quote: "q1", severity: "high", startMs: 61_000 });
  });
});
