import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// The letter's read/write split (E-24 criterion 3, closing E-18's read-that-wrote
// limitation): GET /api/letter mutates nothing; POST /api/letter/viewed records
// the viewed marker and is forward-only. Real DB, real ffprobe — env points the
// DB + data root at a throwaway dir before any getDb() (lazy) so the singleton
// binds to it, mirroring sessions-api.test.

let root: string;
let LETTER_GET: typeof import("@/app/api/letter/route").GET;
let VIEWED_POST: typeof import("@/app/api/letter/viewed/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let getViewedLetterWeek: typeof import("@/lib/plan").getViewedLetterWeek;
let upsertSegment: typeof import("@/lib/segments").upsertSegment;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let enqueueAnalysis: typeof import("@/lib/analysis/cascade").enqueueAnalysis;

const HOUR_MS = 3_600_000;
const WEEK = "2026-07-13"; // a Monday
const LATER_WEEK = "2026-07-20"; // the Monday after

beforeAll(async () => {
  root = tmpDir("erika-letter-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  LETTER_GET = (await import("@/app/api/letter/route")).GET;
  VIEWED_POST = (await import("@/app/api/letter/viewed/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  getViewedLetterWeek = (await import("@/lib/plan")).getViewedLetterWeek;
  upsertSegment = (await import("@/lib/segments")).upsertSegment;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  enqueueAnalysis = (await import("@/lib/analysis/cascade")).enqueueAnalysis;
});

afterEach(() => {
  const db = getDb();
  db.prepare("DELETE FROM sessions").run();
  db.prepare("DELETE FROM settings WHERE key = 'letterViewedWeek'").run();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// Seed one analyzed session in `week` with a finding, so a letter exists for it.
function seedAnalyzed(id: string, week: string) {
  const db = getDb();
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${week} 09:00:00`, id);
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR_MS, contentHash: `${id}-h0` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h0`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "high", startMs: 0, endMs: 500 },
    ],
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
}

function letterReq(week?: string) {
  const url = week ? `http://localhost/api/letter?week=${week}` : "http://localhost/api/letter";
  return new Request(url);
}

function viewedReq(body?: unknown) {
  return new Request("http://localhost/api/letter/viewed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("GET /api/letter — reads, never writes (criterion 3)", () => {
  it("leaves the viewed marker unchanged across two GETs of an unviewed week", async () => {
    seedAnalyzed("s1", WEEK);
    expect(getViewedLetterWeek(getDb())).toBeNull();

    const first = await (await LETTER_GET(letterReq())).json();
    expect(first.letter.weekStart).toBe(WEEK);
    expect(getViewedLetterWeek(getDb())).toBeNull(); // GET did not mark

    await LETTER_GET(letterReq());
    expect(getViewedLetterWeek(getDb())).toBeNull(); // still unmarked
  });
});

describe("POST /api/letter/viewed — records the marker (criterion 3)", () => {
  it("marks the named week viewed", async () => {
    seedAnalyzed("s1", WEEK);
    const res = await VIEWED_POST(viewedReq({ week: WEEK }));
    expect(res.status).toBe(200);
    expect((await res.json()).viewedWeek).toBe(WEEK);
    expect(getViewedLetterWeek(getDb())).toBe(WEEK);
  });

  it("defaults to the latest week with findings when no week is given", async () => {
    seedAnalyzed("s1", WEEK);
    seedAnalyzed("s2", LATER_WEEK);
    const res = await VIEWED_POST(viewedReq());
    expect((await res.json()).viewedWeek).toBe(LATER_WEEK);
    expect(getViewedLetterWeek(getDb())).toBe(LATER_WEEK);
  });

  it("is forward-only — re-posting an older or equal week never regresses the marker", async () => {
    seedAnalyzed("s1", WEEK);
    seedAnalyzed("s2", LATER_WEEK);

    await VIEWED_POST(viewedReq({ week: LATER_WEEK }));
    expect(getViewedLetterWeek(getDb())).toBe(LATER_WEEK);

    // An older week must not pull the marker back.
    const older = await VIEWED_POST(viewedReq({ week: WEEK }));
    expect((await older.json()).viewedWeek).toBe(LATER_WEEK);
    expect(getViewedLetterWeek(getDb())).toBe(LATER_WEEK);

    // An equal week is also a no-op.
    await VIEWED_POST(viewedReq({ week: LATER_WEEK }));
    expect(getViewedLetterWeek(getDb())).toBe(LATER_WEEK);
  });

  it("rejects a malformed week in the boundary error envelope", async () => {
    const res = await VIEWED_POST(viewedReq({ week: "last-tuesday" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_week");
    expect(typeof body.error.message).toBe("string");
  });

  it("returns viewedWeek null when nothing is analyzed yet", async () => {
    const res = await VIEWED_POST(viewedReq());
    expect(res.status).toBe(200);
    expect((await res.json()).viewedWeek).toBeNull();
    expect(getViewedLetterWeek(getDb())).toBeNull();
  });
});
