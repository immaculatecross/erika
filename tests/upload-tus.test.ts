import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Upload } from "@tus/server";
import { makeWav, tmpDir } from "./helpers";

// The tus resumable-upload path (E-24 criteria 4–6), driven through the real tus
// protocol against the real Server.handleWeb — creation POST then PATCH(es) —
// with real ffprobe. A completed tus upload must finalize into the EXACT same
// end state as the streamed POST: one session row, one queued ingest job, the
// probed duration and format. Rejections leave neither file nor row. Env points
// the DB + data root at a throwaway dir before any lazy singleton binds.

let root: string;
let getTusServer: typeof import("@/lib/tus-server").getTusServer;
let getUploadStore: typeof import("@/lib/tus-server").getUploadStore;
let sweepExpiredUploads: typeof import("@/lib/tus-server").sweepExpiredUploads;
let uploadsDir: typeof import("@/lib/tus-server").uploadsDir;
let SESSIONS_POST: typeof import("@/app/api/sessions/route").POST;
let getDb: typeof import("@/lib/db").getDb;

beforeAll(async () => {
  root = tmpDir("erika-tus-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  process.env.TUS_UPLOAD_TTL_MS = "3600000"; // 1 h, read once at store construction
  ({ getTusServer, getUploadStore, sweepExpiredUploads, uploadsDir } = await import("@/lib/tus-server"));
  SESSIONS_POST = (await import("@/app/api/sessions/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
});

afterEach(() => {
  delete process.env.MAX_DURATION_SECONDS;
  getDb().prepare("DELETE FROM sessions").run();
  fs.rmSync(path.join(root, "sessions"), { recursive: true, force: true });
  fs.rmSync(uploadsDir(), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function wavBytes(seconds = 1): Uint8Array {
  const f = path.join(root, "src.wav");
  makeWav(f, seconds);
  const bytes = fs.readFileSync(f);
  fs.rmSync(f);
  return new Uint8Array(bytes);
}

// One full tus upload against handleWeb: create, then PATCH `bytes` in `chunks`.
// Returns the final PATCH response so tests can assert its status.
async function tusUpload(filename: string, bytes: Uint8Array, chunks = 1): Promise<Response> {
  const server = getTusServer();
  const create = await server.handleWeb(
    new Request("http://localhost/api/upload", {
      method: "POST",
      headers: {
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(bytes.length),
        "Upload-Metadata": `filename ${Buffer.from(filename).toString("base64")}`,
      },
    }),
  );
  expect(create.status).toBe(201);
  const location = create.headers.get("location")!;
  const url = location.startsWith("http") ? location : `http://localhost${location}`;

  const size = Math.ceil(bytes.length / chunks);
  let offset = 0;
  let last: Response = create;
  while (offset < bytes.length) {
    const slice = bytes.subarray(offset, offset + size);
    last = await server.handleWeb(
      new Request(url, {
        method: "PATCH",
        headers: {
          "Tus-Resumable": "1.0.0",
          "Upload-Offset": String(offset),
          "Content-Type": "application/offset+octet-stream",
        },
        body: slice as BodyInit,
      }),
    );
    offset += slice.length;
  }
  return last;
}

function streamedUpload(filename: string, bytes: Uint8Array): Promise<Response> {
  return SESSIONS_POST(
    new Request("http://localhost/api/sessions", {
      method: "POST",
      headers: { "x-filename": encodeURIComponent(filename) },
      body: bytes as BodyInit,
    }),
  );
}

function sessionRows() {
  return getDb()
    .prepare(
      `SELECT s.id, s.format, s.size_bytes, s.duration_seconds, j.state
       FROM sessions s JOIN ingest_jobs j ON j.session_id = s.id`,
    )
    .all() as { id: string; format: string; size_bytes: number; duration_seconds: number; state: string }[];
}

function sessionDirs(): string[] {
  const dir = path.join(root, "sessions");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

function leftoverUploads(): string[] {
  const dir = uploadsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => !f.endsWith(".json"));
}

describe("tus completion finalizes identically to the streamed path (criterion 5)", () => {
  it("yields exactly one session with one queued job and the probed duration/format", async () => {
    const bytes = wavBytes(1);
    const res = await tusUpload("clip.wav", bytes);
    expect(res.status).toBe(204);

    const rows = sessionRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("queued");
    expect(rows[0].format).toBe("wav");
    expect(rows[0].size_bytes).toBe(bytes.length);
    expect(rows[0].duration_seconds).toBeGreaterThan(0.8);

    // The tus staging artifact is reclaimed once finalized — no leftover bytes.
    expect(leftoverUploads()).toEqual([]);
  });

  it("matches a streamed upload of the same bytes — same observable end state", async () => {
    const bytes = wavBytes(1);

    await tusUpload("same.wav", bytes);
    const viaTus = sessionRows()[0];

    getDb().prepare("DELETE FROM sessions").run();
    fs.rmSync(path.join(root, "sessions"), { recursive: true, force: true });

    const streamed = await streamedUpload("same.wav", bytes);
    expect(streamed.status).toBe(201);
    const viaStream = sessionRows()[0];

    expect(viaTus.format).toBe(viaStream.format);
    expect(viaTus.size_bytes).toBe(viaStream.size_bytes);
    expect(viaTus.state).toBe(viaStream.state);
    expect(viaTus.duration_seconds).toBeCloseTo(viaStream.duration_seconds, 2);
  });

  it("resumes across two PATCH chunks and still finalizes once", async () => {
    const bytes = wavBytes(1);
    const res = await tusUpload("resumed.wav", bytes, 2);
    expect(res.status).toBe(204);
    expect(sessionRows()).toHaveLength(1);
    expect(sessionRows()[0].size_bytes).toBe(bytes.length);
  });
});

describe("tus rejections leave neither file nor row (criterion 5)", () => {
  it("rejects an over-cap (too-long) upload and cleans both stores", async () => {
    process.env.MAX_DURATION_SECONDS = "0.1";
    const res = await tusUpload("long.wav", wavBytes(1));
    expect(res.status).toBe(413);
    expect(sessionRows()).toEqual([]);
    expect(sessionDirs()).toEqual([]);
    expect(leftoverUploads()).toEqual([]);
  });

  it("rejects an unsupported format and cleans both stores", async () => {
    const res = await tusUpload("notes.txt", new Uint8Array(Buffer.from("not audio at all")));
    expect(res.status).toBe(415);
    expect(sessionRows()).toEqual([]);
    expect(sessionDirs()).toEqual([]);
    expect(leftoverUploads()).toEqual([]);
  });

  it("rejects an undecodable file with a .wav name", async () => {
    const res = await tusUpload("fake.wav", new Uint8Array(Buffer.from("still not audio")));
    expect(res.status).toBe(422);
    expect(sessionRows()).toEqual([]);
    expect(sessionDirs()).toEqual([]);
    expect(leftoverUploads()).toEqual([]);
  });
});

describe("partial-upload GC (criterion 6)", () => {
  // A partial upload is one whose config records size !== offset. deleteExpired
  // removes those older than the TTL; fresh ones and completed ones are kept.
  function seedPartial(id: string, createdAt: Date) {
    const store = getUploadStore();
    fs.mkdirSync(uploadsDir(), { recursive: true });
    fs.writeFileSync(path.join(uploadsDir(), id), Buffer.from("partial bytes"));
    // configstore writes <id>.json next to the data file. size !== offset marks
    // it incomplete, which is what deleteExpired reclaims.
    return store.configstore.set(
      id,
      new Upload({
        id,
        size: 1000,
        offset: 13,
        metadata: { filename: "wip.wav" },
        creation_date: createdAt.toISOString(),
      }),
    );
  }

  it("reclaims an expired partial upload but retains a fresh one", async () => {
    const expired = "expired-upload";
    const fresh = "fresh-upload";
    await seedPartial(expired, new Date(Date.now() - 2 * 3600000)); // 2 h old > 1 h TTL
    await seedPartial(fresh, new Date()); // just now

    const removed = await sweepExpiredUploads();
    expect(removed).toBe(1);

    expect(fs.existsSync(path.join(uploadsDir(), expired))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), `${expired}.json`))).toBe(false);
    expect(fs.existsSync(path.join(uploadsDir(), fresh))).toBe(true);
    expect(fs.existsSync(path.join(uploadsDir(), `${fresh}.json`))).toBe(true);
  });
});
