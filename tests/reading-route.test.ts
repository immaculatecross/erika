import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";

// E-33 criterion 3: the reading/listening routes. GET returns a canon passage
// matched to the learner's edge plus the listen estimate; POST renders the passage
// through the shared E-21 biller (render once, replay bills zero, cap refuses); the
// /audio route streams it. D-13: the TTS client is mocked module-wide.

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
let viewGET: typeof import("@/app/api/reading/route").GET;
let renderPOST: typeof import("@/app/api/reading/[passageId]/route").POST;
let audioGET: typeof import("@/app/api/reading/[passageId]/audio/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let writeSettings: typeof import("@/lib/settings").writeSettings;

beforeAll(async () => {
  root = tmpDir("erika-reading-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  viewGET = (await import("@/app/api/reading/route")).GET;
  renderPOST = (await import("@/app/api/reading/[passageId]/route")).POST;
  audioGET = (await import("@/app/api/reading/[passageId]/audio/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  writeSettings = (await import("@/lib/settings")).writeSettings;
});

afterEach(() => {
  getDb().prepare("DELETE FROM spend_ledger").run();
  getDb().prepare("DELETE FROM phrase_renders").run();
  fs.rmSync(path.join(root, "phrase-renders"), { recursive: true, force: true });
  writeSettings(getDb(), { monthlyBudgetUsd: 25 });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const pCtx = (passageId: string) => ({ params: Promise.resolve({ passageId }) });
const req = (method = "GET") => new Request("http://localhost", { method });
function ttsLedgerCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
}

describe("GET /api/reading", () => {
  it("returns an edge, a passage, and a listen estimate", async () => {
    const body = await (await viewGET()).json();
    expect(body.edge).toBeTruthy();
    expect(body.passage).not.toBeNull();
    expect(body.passage.text.length).toBeGreaterThan(0);
    expect(body.listen.exists).toBe(false);
    expect(body.listen.estimateUsd).toBeGreaterThan(0);
  });
});

describe("POST /api/reading/[passageId] (listen render)", () => {
  it("renders once (201), replays free (200), bills one row; unknown passage 404s", async () => {
    const passageId = (await (await viewGET()).json()).passage.id as string;
    const first = await renderPOST(req("POST"), pCtx(passageId));
    expect(first.status).toBe(201);
    const second = await renderPOST(req("POST"), pCtx(passageId));
    expect(second.status).toBe(200);
    expect(ttsLedgerCount()).toBe(1);

    const audio = await audioGET(req(), pCtx(passageId));
    expect(audio.status).toBe(200);
    expect(audio.headers.get("Content-Type")).toBe("audio/mpeg");

    expect((await renderPOST(req("POST"), pCtx("nope"))).status).toBe(404);
  });

  it("refuses at the budget cap (402), no ledger row", async () => {
    const passageId = (await (await viewGET()).json()).passage.id as string;
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const res = await renderPOST(req("POST"), pCtx(passageId));
    expect(res.status).toBe(402);
    expect(ttsLedgerCount()).toBe(0);
  });
});
