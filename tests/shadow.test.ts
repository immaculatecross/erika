import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";

// E-33 criterion 2 (D-18/D-21): the listen-and-shadow format. The shadow TARGET is
// the finding's CORRECT correction, NEVER the learner's error (D-18) — asserted at
// the read-model AND through the route. The render reuses the shared E-21 biller:
// render once, replays bill zero, the cap refuses truthfully. D-13: the TTS client
// is mocked module-wide, so no route test makes a network call. No scoring here.

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
let statusGET: typeof import("@/app/api/shadow/[findingId]/route").GET;
let renderPOST: typeof import("@/app/api/shadow/[findingId]/route").POST;
let audioGET: typeof import("@/app/api/shadow/[findingId]/audio/route").GET;
let listGET: typeof import("@/app/api/shadow/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let shadowTarget: typeof import("@/lib/shadow").shadowTarget;

beforeAll(async () => {
  root = tmpDir("erika-shadow-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  statusGET = (await import("@/app/api/shadow/[findingId]/route")).GET;
  renderPOST = (await import("@/app/api/shadow/[findingId]/route")).POST;
  audioGET = (await import("@/app/api/shadow/[findingId]/audio/route")).GET;
  listGET = (await import("@/app/api/shadow/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  shadowTarget = (await import("@/lib/shadow")).shadowTarget;
});

afterEach(() => {
  getDb().prepare("DELETE FROM sessions").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
  getDb().prepare("DELETE FROM phrase_renders").run();
  fs.rmSync(path.join(root, "phrase-renders"), { recursive: true, force: true });
  writeSettings(getDb(), { monthlyBudgetUsd: 25 });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const fCtx = (findingId: string) => ({ params: Promise.resolve({ findingId }) });
const req = (method = "GET") => new Request("http://localhost", { method });

let seq = 0;
function seedFinding(sessionId: string, quote = "una problema", correction = "un problema"): string {
  createSession(getDb(), { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(getDb(), {
    sessionId,
    contentHash: `${sessionId}-h${seq++}`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote, correction, category: "grammar", explanation: "gender agreement", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
  return (getDb().prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
}

function ttsLedgerCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
}

describe("shadow target is the CORRECT form, never the error (D-18)", () => {
  it("shadowTarget returns the correction, not the quote", () => {
    const fid = seedFinding("d18a", "ho andato", "sono andato");
    const drill = shadowTarget(getDb(), fid)!;
    expect(drill.target).toBe("sono andato"); // the correction
    expect(drill.target).not.toBe("ho andato"); // never the learner's error
  });

  it("the route echoes the correction as the target, not the quote", async () => {
    const fid = seedFinding("d18b", "ho andato", "sono andato");
    const body = await (await statusGET(req(), fCtx(fid))).json();
    expect(body.target).toBe("sono andato");
    expect(body.target).not.toBe("ho andato");
    expect(body.exists).toBe(false);
    expect(body.estimateUsd).toBeGreaterThan(0);
  });

  it("404s for an unknown finding", async () => {
    expect((await statusGET(req(), fCtx("nope"))).status).toBe(404);
  });
});

describe("shadow render reuses the E-21 biller (money-path)", () => {
  it("renders once (201), replays as a cache hit (200), bills exactly one row", async () => {
    const fid = seedFinding("r1");
    const first = await renderPOST(req("POST"), fCtx(fid));
    expect(first.status).toBe(201);
    expect((await first.json()).generated).toBe(true);

    const second = await renderPOST(req("POST"), fCtx(fid));
    expect(second.status).toBe(200);
    expect((await second.json()).generated).toBe(false);

    expect(ttsLedgerCount()).toBe(1);
    // The rendered phrase is the CORRECTION (D-18), stored in the cache row.
    const rowText = (getDb().prepare("SELECT text FROM phrase_renders").get() as { text: string }).text;
    expect(rowText).toBe("un problema");
  });

  it("refuses at the budget cap (402) with no model call and no ledger row", async () => {
    const fid = seedFinding("r2");
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const res = await renderPOST(req("POST"), fCtx(fid));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/budget/i);
    expect(ttsLedgerCount()).toBe(0);
  });
});

describe("GET /api/shadow/[findingId]/audio", () => {
  it("404s before render, streams mp3 after", async () => {
    const fid = seedFinding("a1");
    expect((await audioGET(req(), fCtx(fid))).status).toBe(404);
    await renderPOST(req("POST"), fCtx(fid));
    const res = await audioGET(req(), fCtx(fid));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });
});

describe("GET /api/shadow (list)", () => {
  it("lists included findings as shadow drills with correct targets", async () => {
    seedFinding("l1", "ho andato", "sono andato");
    const body = await (await listGET()).json();
    expect(body.drills.length).toBeGreaterThan(0);
    for (const d of body.drills) expect(typeof d.target).toBe("string");
    expect(body.drills.some((d: { target: string }) => d.target === "sono andato")).toBe(true);
  });
});
