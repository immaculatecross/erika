import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";

// WO criterion 4: a completed tutor call records CLIENT-SIDE and lands as a NORMAL
// session through the SAME capture→ingest path as any recording — no separate tutor
// findings channel. So its findings are the one truth (E-17). And the tutor `end`
// route finalizes MONEY only: it never writes findings or evidence. These two facts
// are what keep the tutor a normal session.

let root: string;
let getDb: typeof import("@/lib/db").getDb;
let finalizeStagedUpload: typeof import("@/lib/finalize-upload").finalizeStagedUpload;
let ensureSessionDir: typeof import("@/lib/audio-storage").ensureSessionDir;
let sourcePath: typeof import("@/lib/audio-storage").sourcePath;
let endPOST: typeof import("@/app/api/tutor/session/[id]/end/route").POST;
let openTutorLease: typeof import("@/lib/tutor/money").openTutorLease;
let REALTIME_FLAGSHIP: typeof import("@/lib/analysis/rates").REALTIME_FLAGSHIP;

beforeAll(async () => {
  root = tmpDir("erika-tutor-rec-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  getDb = (await import("@/lib/db")).getDb;
  finalizeStagedUpload = (await import("@/lib/finalize-upload")).finalizeStagedUpload;
  ensureSessionDir = (await import("@/lib/audio-storage")).ensureSessionDir;
  sourcePath = (await import("@/lib/audio-storage")).sourcePath;
  endPOST = (await import("@/app/api/tutor/session/[id]/end/route")).POST;
  openTutorLease = (await import("@/lib/tutor/money")).openTutorLease;
  REALTIME_FLAGSHIP = (await import("@/lib/analysis/rates")).REALTIME_FLAGSHIP;
});

afterEach(() => {
  getDb().prepare("DELETE FROM sessions").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("a tutor recording lands as a normal session", () => {
  it("finalizes through the ONE ingestion path into a session + queued ingest job", async () => {
    const id = "tutor-take-1";
    await ensureSessionDir(id);
    const src = sourcePath(id, "wav");
    const sizeBytes = makeWav(src, 1);

    const session = await finalizeStagedUpload({ id, filename: "tutor-conversation.wav", format: "wav", sourceFile: src, sizeBytes });
    expect(session.id).toBe(id);
    // A NORMAL session with a queued ingest job — the exact shape any capture yields.
    expect(session.jobState).toBe("queued");
    const job = getDb().prepare("SELECT state FROM ingest_jobs WHERE session_id = ?").get(id) as { state: string };
    expect(job.state).toBe("queued");
    // No separate findings channel exists — findings arrive only from analysis, later.
    const findings = getDb().prepare("SELECT COUNT(*) AS n FROM findings WHERE session_id = ?").get(id) as { n: number };
    expect(findings.n).toBe(0);
  });
});

describe("the tutor end route finalizes money only", () => {
  it("commits one ledger row and writes NO findings or evidence", async () => {
    const tutorId = "tutor-money-1";
    openTutorLease(getDb(), tutorId, REALTIME_FLAGSHIP, 10, 100);

    const req = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ elapsedSeconds: 180 }),
    });
    const res = await endPOST(req, { params: Promise.resolve({ id: tutorId }) });
    expect(res.status).toBe(200);
    expect((await res.json()).committedUsd).toBeGreaterThan(0);

    const committed = getDb()
      .prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE content_hash = ? AND state='committed'")
      .get(`tutor:${tutorId}`) as { n: number };
    expect(committed.n).toBe(1);
    // The route touched no findings and no evidence — findings stay the one truth.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(0);
  });
});
