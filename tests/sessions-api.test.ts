import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { makeWav, streamOf, tmpDir } from "./helpers";

// End-to-end route tests: real filesystem, real ffprobe. Env points the DB and
// the data root at a throwaway dir before any getDb() (which is lazy), so the
// singleton binds to it. Route modules are imported after that in beforeAll.

let root: string;
let POST: typeof import("@/app/api/sessions/route").POST;
let GET_LIST: typeof import("@/app/api/sessions/route").GET;
let GET_ONE: typeof import("@/app/api/sessions/[id]/route").GET;
let DELETE_ONE: typeof import("@/app/api/sessions/[id]/route").DELETE;
let GET_AUDIO: typeof import("@/app/api/sessions/[id]/audio/route").GET;
let sourcePath: typeof import("@/lib/audio-storage").sourcePath;
let getDb: typeof import("@/lib/db").getDb;

beforeAll(async () => {
  root = tmpDir("erika-api-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  POST = (await import("@/app/api/sessions/route")).POST;
  GET_LIST = (await import("@/app/api/sessions/route")).GET;
  ({ GET: GET_ONE, DELETE: DELETE_ONE } = await import("@/app/api/sessions/[id]/route"));
  GET_AUDIO = (await import("@/app/api/sessions/[id]/audio/route")).GET;
  sourcePath = (await import("@/lib/audio-storage")).sourcePath;
  getDb = (await import("@/lib/db")).getDb;
});

afterEach(() => {
  delete process.env.MAX_UPLOAD_BYTES;
  delete process.env.MAX_DURATION_SECONDS;
  // Clear rows and files between tests so each assertion is isolated.
  getDb().prepare("DELETE FROM sessions").run();
  fs.rmSync(path.join(root, "sessions"), { recursive: true, force: true });
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function post(name: string, body: BodyInit): Promise<Response> {
  const init = {
    method: "POST",
    headers: { "x-filename": encodeURIComponent(name) },
    body,
    duplex: "half",
  } as RequestInit;
  return POST(new Request("http://localhost/api/sessions", init));
}

function wavBytes(seconds = 1): Uint8Array {
  const f = path.join(root, "src.wav");
  makeWav(f, seconds);
  const bytes = fs.readFileSync(f);
  fs.rmSync(f);
  return new Uint8Array(bytes);
}

function sessionDirs(): string[] {
  const dir = path.join(root, "sessions");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

describe("POST /api/sessions", () => {
  it("streams an under-cap upload and lands the exact bytes (criterion 1)", async () => {
    const bytes = wavBytes(1);
    const res = await post("clip.wav", streamOf(bytes, 4096));
    expect(res.status).toBe(201);
    const s = await res.json();
    expect(s.sizeBytes).toBe(bytes.length);
    expect(s.jobState).toBe("queued");
    const onDisk = fs.readFileSync(sourcePath(s.id, "wav"));
    expect(Buffer.compare(onDisk, Buffer.from(bytes))).toBe(0);
    expect(s.durationSeconds).toBeGreaterThan(0.8);
  });

  it("aborts mid-stream over the byte cap and leaves no file or row (criterion 1)", async () => {
    process.env.MAX_UPLOAD_BYTES = "1024";
    const res = await post("big.wav", streamOf(wavBytes(1), 512));
    expect(res.status).toBe(413);
    expect(sessionDirs()).toEqual([]);
    expect(await (await GET_LIST()).json()).toEqual([]);
  });

  it("rejects an unsupported extension before touching disk (criterion 2)", async () => {
    const res = await post("notes.txt", streamOf(new Uint8Array([1, 2, 3])));
    expect(res.status).toBe(415);
    expect(sessionDirs()).toEqual([]);
  });

  it("rejects an undecodable file and cleans up (criterion 2)", async () => {
    const res = await post("fake.wav", streamOf(new Uint8Array(Buffer.from("not audio"))));
    expect(res.status).toBe(422);
    expect(sessionDirs()).toEqual([]);
  });

  it("rejects audio longer than the duration cap and cleans up (criterion 3)", async () => {
    process.env.MAX_DURATION_SECONDS = "0.1";
    const res = await post("long.wav", streamOf(wavBytes(1), 4096));
    expect(res.status).toBe(413);
    expect(sessionDirs()).toEqual([]);
  });
});

describe("GET list + detail + delete", () => {
  it("lists a created session, then deletes rows and files (criteria 4, 7)", async () => {
    const s = await (await post("keep.wav", streamOf(wavBytes(1)))).json();
    const list = await (await GET_LIST()).json();
    expect(list.map((x: { id: string }) => x.id)).toEqual([s.id]);

    const ctx = { params: Promise.resolve({ id: s.id }) };
    expect((await GET_ONE(new Request("http://localhost"), ctx)).status).toBe(200);
    expect(fs.existsSync(sourcePath(s.id, "wav"))).toBe(true);

    const del = await DELETE_ONE(new Request("http://localhost"), ctx);
    expect(del.status).toBe(200);
    expect(fs.existsSync(path.join(root, "sessions", s.id))).toBe(false);
    const after = await GET_ONE(new Request("http://localhost"), ctx);
    expect(after.status).toBe(404);
  });
});

describe("GET audio with Range (criterion 5)", () => {
  it("returns 206 with the correct partial bytes, and 200 for a full request", async () => {
    const bytes = wavBytes(1);
    const s = await (await post("play.wav", streamOf(bytes))).json();
    const url = `http://localhost/api/sessions/${s.id}/audio`;
    const ctx = { params: Promise.resolve({ id: s.id }) };

    const partial = await GET_AUDIO(new Request(url, { headers: { range: "bytes=0-9" } }), ctx);
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 0-9/${bytes.length}`);
    expect(partial.headers.get("accept-ranges")).toBe("bytes");
    const body = new Uint8Array(await partial.arrayBuffer());
    expect(body.length).toBe(10);
    expect(Buffer.compare(Buffer.from(body), Buffer.from(bytes.subarray(0, 10)))).toBe(0);

    const full = await GET_AUDIO(new Request(url), ctx);
    expect(full.status).toBe(200);
    expect(full.headers.get("content-length")).toBe(String(bytes.length));
  });
});
