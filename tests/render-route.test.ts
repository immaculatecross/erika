import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";

// The E-21 rendition routes (D-13: the TTS client is mocked module-wide, so no
// route test makes a network call). GET status primes the Compare control; POST
// renders once and refuses (402) at the budget cap; the /audio route streams the
// clip and 404s orphan-safely; and the session DELETE route unlinks the files the
// FK cascade leaves behind. Real DB + throwaway data dir, env set before getDb binds.

vi.mock("@/lib/render/tts-model", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/render/tts-model")>();
  return {
    ...actual,
    openAiTtsModel: {
      async synthesize() {
        return { audio: Buffer.from("ID3-fake-mp3-bytes-for-tests"), format: "mp3" };
      },
    },
  };
});

let root: string;
let statusGET: typeof import("@/app/api/renditions/[findingId]/route").GET;
let generatePOST: typeof import("@/app/api/renditions/[findingId]/route").POST;
let audioGET: typeof import("@/app/api/renditions/[findingId]/audio/route").GET;
let sessionDELETE: typeof import("@/app/api/sessions/[id]/route").DELETE;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let getRendition: typeof import("@/lib/render/renditions").getRendition;

beforeAll(async () => {
  root = tmpDir("erika-render-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  statusGET = (await import("@/app/api/renditions/[findingId]/route")).GET;
  generatePOST = (await import("@/app/api/renditions/[findingId]/route")).POST;
  audioGET = (await import("@/app/api/renditions/[findingId]/audio/route")).GET;
  sessionDELETE = (await import("@/app/api/sessions/[id]/route")).DELETE;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  getRendition = (await import("@/lib/render/renditions")).getRendition;
});

afterEach(() => {
  getDb().prepare("DELETE FROM sessions").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
  fs.rmSync(path.join(root, "renditions"), { recursive: true, force: true });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const fCtx = (findingId: string) => ({ params: Promise.resolve({ findingId }) });
const sCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method = "GET") => new Request("http://localhost", { method });

let seq = 0;
function seedFinding(sessionId: string): string {
  createSession(getDb(), { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(getDb(), {
    sessionId,
    contentHash: `${sessionId}-h${seq++}`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: "una problema", correction: "un problema", category: "grammar", explanation: "gender", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
  return (getDb().prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
}

function ttsLedgerCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
}

describe("GET /api/renditions/[findingId] (status)", () => {
  it("404s for an unknown finding", async () => {
    expect((await statusGET(req(), fCtx("nope"))).status).toBe(404);
  });

  it("reports not-yet-rendered with an estimate and the clip coordinates", async () => {
    const fid = seedFinding("st1");
    const body = await (await statusGET(req(), fCtx(fid))).json();
    expect(body.exists).toBe(false);
    expect(body.estimateUsd).toBeGreaterThan(0);
    expect(body.clip).toEqual({ sessionId: "st1", startMs: 1000, endMs: 1500 });
  });
});

describe("POST /api/renditions/[findingId] (generate)", () => {
  it("renders once (201), replays as a cache hit (200), bills exactly one row", async () => {
    const fid = seedFinding("gen1");
    const first = await generatePOST(req("POST"), fCtx(fid));
    expect(first.status).toBe(201);
    expect((await first.json()).generated).toBe(true);

    const second = await generatePOST(req("POST"), fCtx(fid));
    expect(second.status).toBe(200);
    expect((await second.json()).generated).toBe(false);

    expect(ttsLedgerCount()).toBe(1);
    expect((await (await statusGET(req(), fCtx(fid))).json()).exists).toBe(true);
  });

  it("refuses at the budget cap (402) with no model call and no ledger row", async () => {
    const fid = seedFinding("gen2");
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const res = await generatePOST(req("POST"), fCtx(fid));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/budget/i);
    expect(ttsLedgerCount()).toBe(0);
    expect(getRendition(getDb(), fid)).toBeNull();
    writeSettings(getDb(), { monthlyBudgetUsd: 25 });
  });
});

describe("GET /api/renditions/[findingId]/audio", () => {
  it("404s when no rendition exists, streams mp3 once generated", async () => {
    const fid = seedFinding("aud1");
    expect((await audioGET(req(), fCtx(fid))).status).toBe(404);

    await generatePOST(req("POST"), fCtx(fid));
    const res = await audioGET(req(), fCtx(fid));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("is orphan-safe: a row whose file is gone answers 404, not a crash", async () => {
    const fid = seedFinding("aud2");
    await generatePOST(req("POST"), fCtx(fid));
    const rendition = getRendition(getDb(), fid)!;
    fs.rmSync(rendition.path);
    expect((await audioGET(req(), fCtx(fid))).status).toBe(404);
  });
});

describe("DELETE /api/sessions/[id] cleans up renditions", () => {
  it("unlinks the rendition file and cascades the row", async () => {
    const fid = seedFinding("del1");
    await generatePOST(req("POST"), fCtx(fid));
    const rendition = getRendition(getDb(), fid)!;
    expect(fs.existsSync(rendition.path)).toBe(true);

    const res = await sessionDELETE(req("DELETE"), sCtx("del1"));
    expect(res.status).toBe(200);
    expect(fs.existsSync(rendition.path)).toBe(false);
    expect(getRendition(getDb(), fid)).toBeNull();
  });
});
