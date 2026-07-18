import fs from "node:fs";
import path from "node:path";
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";

// The E-23 Ask Erika route (D-13: the text-model client is mocked module-wide, so
// no route test makes a network call). GET status primes the ask control; POST asks
// once (201) then re-opens as a cache hit (200) with exactly one ledger row; the
// budget cap refuses truthfully (402) with no call and no row; and the note
// cascades when its session is deleted. Real DB + throwaway data dir, env set
// before getDb binds.

vi.mock("@/lib/lessons/text-model", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/lessons/text-model")>();
  return {
    ...actual,
    openAiTextModel: {
      async complete({ prompt }: { prompt: string; maxOutputTokens: number }) {
        const m = prompt.match(/\[([^\]]+)\]/);
        return {
          text: JSON.stringify({ note: "A deeper note about gender agreement.", cites: m ? [m[1]] : [] }),
          promptTokens: 100,
          completionTokens: 40,
        };
      },
    },
  };
});

let root: string;
let statusGET: typeof import("@/app/api/ask/[findingId]/route").GET;
let askPOST: typeof import("@/app/api/ask/[findingId]/route").POST;
let sessionDELETE: typeof import("@/app/api/sessions/[id]/route").DELETE;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let getCompletedNote: typeof import("@/lib/ask/notes").getCompletedNote;

beforeAll(async () => {
  root = tmpDir("erika-ask-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  statusGET = (await import("@/app/api/ask/[findingId]/route")).GET;
  askPOST = (await import("@/app/api/ask/[findingId]/route")).POST;
  sessionDELETE = (await import("@/app/api/sessions/[id]/route")).DELETE;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  getCompletedNote = (await import("@/lib/ask/notes")).getCompletedNote;
});

afterEach(() => {
  getDb().prepare("DELETE FROM sessions").run();
  getDb().prepare("DELETE FROM spend_ledger").run();
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const fCtx = (findingId: string) => ({ params: Promise.resolve({ findingId }) });
const sCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method = "GET") => new Request("http://localhost", { method });

let seq = 0;
function seedOne(sessionId: string, correction: string): string {
  createSession(getDb(), { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(getDb(), {
    sessionId,
    contentHash: `${sessionId}-h${seq++}`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: `q-${sessionId}`, correction, category: "grammar", explanation: "gender", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
  return (getDb().prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
}

/** Target finding plus a second finding so there is always an OTHER one to cite. */
function seedCorpus(): string {
  const target = seedOne("target", "un problema");
  seedOne("other", "una cosa");
  return target;
}

function ledgerCount(): number {
  return (getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
}

describe("GET /api/ask/[findingId] (status)", () => {
  it("404s for an unknown finding", async () => {
    expect((await statusGET(req(), fCtx("nope"))).status).toBe(404);
  });

  it("reports not-yet-asked with an estimate and that an ask is possible", async () => {
    const fid = seedCorpus();
    const body = await (await statusGET(req(), fCtx(fid))).json();
    expect(body.exists).toBe(false);
    expect(body.canAsk).toBe(true);
    expect(body.estimateUsd).toBeGreaterThan(0);
  });
});

describe("POST /api/ask/[findingId] (ask)", () => {
  it("asks once (201) citing a real other finding, re-opens as a cache hit (200), bills one row", async () => {
    const fid = seedCorpus();
    const first = await askPOST(req("POST"), fCtx(fid));
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.exists).toBe(true);
    expect(firstBody.note.length).toBeGreaterThan(0);
    expect(firstBody.cited.length).toBeGreaterThanOrEqual(1);
    expect(firstBody.cited[0].id).not.toBe(fid);

    const second = await askPOST(req("POST"), fCtx(fid));
    expect(second.status).toBe(200);

    expect(ledgerCount()).toBe(1);
    const status = await (await statusGET(req(), fCtx(fid))).json();
    expect(status.exists).toBe(true);
    expect(status.note.length).toBeGreaterThan(0);
    expect(status.cited.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses at the budget cap (402) with no model call and no ledger row", async () => {
    const fid = seedCorpus();
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const res = await askPOST(req("POST"), fCtx(fid));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toMatch(/budget/i);
    expect(ledgerCount()).toBe(0);
    expect(getCompletedNote(getDb(), fid)).toBeNull();
    writeSettings(getDb(), { monthlyBudgetUsd: 25 });
  });

  it("refuses (409) when there is no other finding to cite", async () => {
    const fid = seedOne("solo", "un problema");
    const res = await askPOST(req("POST"), fCtx(fid));
    expect(res.status).toBe(409);
    expect(ledgerCount()).toBe(0);
  });
});

describe("DELETE /api/sessions/[id] cascades the ask note", () => {
  it("removes the note when its session is deleted", async () => {
    const fid = seedCorpus();
    await askPOST(req("POST"), fCtx(fid));
    expect(getCompletedNote(getDb(), fid)).not.toBeNull();

    const res = await sessionDELETE(req("DELETE"), sCtx("target"));
    expect(res.status).toBe(200);
    expect(getCompletedNote(getDb(), fid)).toBeNull();
  });
});
