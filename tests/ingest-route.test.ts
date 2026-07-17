import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// The read-only ingest route (E-3 part 2 criteria 1 & 4). Real DB under a
// throwaway dir; env is set before the lazy getDb() binds. The job is driven by
// updating the row directly — this route never runs the worker, it only reflects
// what the pipeline left behind.

let root: string;
let GET: typeof import("@/app/api/sessions/[id]/ingest/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let upsertSegment: typeof import("@/lib/segments").upsertSegment;

beforeAll(async () => {
  root = tmpDir("erika-ingest-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  GET = (await import("@/app/api/sessions/[id]/ingest/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  upsertSegment = (await import("@/lib/segments")).upsertSegment;
});

afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost");

function seed(id: string, durationSeconds: number) {
  createSession(getDb(), {
    id,
    originalFilename: `${id}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds,
  });
}

function setJob(
  id: string,
  patch: { state: string; stage?: string | null; progress?: number; error?: string | null },
) {
  getDb()
    .prepare("UPDATE ingest_jobs SET state=?, stage=?, progress=?, error=? WHERE session_id=?")
    .run(patch.state, patch.stage ?? null, patch.progress ?? 0, patch.error ?? null, id);
}

describe("GET /api/sessions/[id]/ingest", () => {
  it("404s for an unknown session", async () => {
    const res = await GET(req(), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("reflects an in-flight job with stage and progress (criterion 1)", async () => {
    seed("proc", 600);
    setJob("proc", { state: "processing", stage: "segmenting", progress: 0.7 });
    const body = await (await GET(req(), ctx("proc"))).json();
    expect(body).toMatchObject({ state: "processing", stage: "segmenting", progress: 0.7, error: null });
    expect(body.summary).toBeDefined();
    expect(body.segments).toEqual([]);
  });

  it("returns the raw-vs-speech summary and segments when done (criteria 1, 2, 3)", async () => {
    seed("ok", 600); // 10 min raw
    upsertSegment(getDb(), { sessionId: "ok", idx: 0, startMs: 1_000, endMs: 61_000, contentHash: "a" });
    upsertSegment(getDb(), { sessionId: "ok", idx: 1, startMs: 120_000, endMs: 240_000, contentHash: "b" });
    setJob("ok", { state: "done", stage: "done", progress: 1 });

    const body = await (await GET(req(), ctx("ok"))).json();
    expect(body.state).toBe("done");
    expect(body.summary.rawMs).toBe(600_000);
    expect(body.summary.speechMs).toBe(60_000 + 120_000);
    expect(body.summary.segmentCount).toBe(2);
    expect(body.segments).toHaveLength(2);
    expect(body.segments[0]).toEqual({ idx: 0, startMs: 1_000, endMs: 61_000, durationMs: 60_000 });
  });

  it("marks a done job with no segments as empty, not a fake success (criterion 4)", async () => {
    seed("empty", 300);
    setJob("empty", { state: "done", stage: "done", progress: 1 });
    const body = await (await GET(req(), ctx("empty"))).json();
    expect(body.state).toBe("done");
    expect(body.summary.segmentCount).toBe(0);
    expect(body.segments).toEqual([]);
  });

  it("surfaces the stored error on a failed job (criterion 4)", async () => {
    seed("bad", 300);
    setJob("bad", { state: "failed", stage: "detecting", error: "ffmpeg exited with code 1" });
    const body = await (await GET(req(), ctx("bad"))).json();
    expect(body.state).toBe("failed");
    expect(body.error).toBe("ffmpeg exited with code 1");
  });
});
