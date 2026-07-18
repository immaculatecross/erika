import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { SlipsIndex, SlipDossier } from "@/lib/slips";

// The two slips routes (E-20): GET the index (every slip + resolved/remission/
// active counts) and GET one dossier (interleaved timeline, 404 when unknown).
// Real DB under a throwaway dir; env is set before the lazy getDb() binds, as in
// the phrasebook-route test.

let root: string;
let slipsGET: typeof import("@/app/api/slips/route").GET;
let dossierGET: typeof import("@/app/api/slips/[id]/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let upsertSegment: typeof import("@/lib/segments").upsertSegment;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let enqueueAnalysis: typeof import("@/lib/analysis/cascade").enqueueAnalysis;

const HOUR = 3_600_000;

beforeAll(async () => {
  root = tmpDir("erika-slips-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  slipsGET = (await import("@/app/api/slips/route")).GET;
  dossierGET = (await import("@/app/api/slips/[id]/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  upsertSegment = (await import("@/lib/segments")).upsertSegment;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  enqueueAnalysis = (await import("@/lib/analysis/cascade")).enqueueAnalysis;
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function seed(id: string, day: string, correction: string) {
  const db = getDb();
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${day} 09:00:00`, id);
  upsertSegment(db, { sessionId: id, idx: 0, startMs: HOUR, endMs: 2 * HOUR, contentHash: `${id}-h` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `${id}-h`,
    flagged: true,
    deepDone: true,
    findings: [{ quote: `${id}-q`, correction, category: "grammar", explanation: "why", severity: "high", startMs: HOUR, endMs: HOUR + 500 }],
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://localhost");

describe("GET /api/slips", () => {
  it("materializes and lists the clustered slip with its counts", async () => {
    seed("a", "2026-07-01", "las manzanas");
    seed("b", "2026-07-02", "Las manzanas."); // same slip, normalized
    const body = (await (await slipsGET()).json()) as SlipsIndex;
    expect(body.slips).toHaveLength(1);
    expect(body.slips[0].occurrences).toBe(2);
    expect(body.activeCount).toBe(1);
    expect(body.resolvedCount).toBe(0);
  });
});

describe("GET /api/slips/[id]", () => {
  it("returns the dossier for a real slip and 404s an unknown one", async () => {
    const id = (getDb().prepare("SELECT id FROM slips LIMIT 1").get() as { id: string }).id;
    const ok = await dossierGET(req(), ctx(id));
    expect(ok.status).toBe(200);
    const dossier = (await ok.json()) as SlipDossier;
    expect(dossier.timeline.filter((i) => i.kind === "occurrence")).toHaveLength(2);

    const missing = await dossierGET(req(), ctx("no-such-slip"));
    expect(missing.status).toBe(404);
  });
});
