import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { PhrasebookEntry } from "@/lib/phrasebook";

// The two Phrasebook routes (E-9): GET the recast library (entries from all
// findings across sessions, each marked in-deck or not) and POST pin (create a
// card for a finding, un-tombstoning a prior delete; idempotent; 404 unknown).
// Real DB under a throwaway dir; env is set before the lazy getDb() binds, as in
// the cards-route test.

let root: string;
let phrasebookGET: typeof import("@/app/api/phrasebook/route").GET;
let pinPOST: typeof import("@/app/api/phrasebook/[findingId]/pin/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let listAllFindings: typeof import("@/lib/analysis/findings").listAllFindings;
let generateCards: typeof import("@/lib/cards").generateCards;
let deleteCard: typeof import("@/lib/cards").deleteCard;
let listDueCards: typeof import("@/lib/cards").listDueCards;

beforeAll(async () => {
  root = tmpDir("erika-phrasebook-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  phrasebookGET = (await import("@/app/api/phrasebook/route")).GET;
  pinPOST = (await import("@/app/api/phrasebook/[findingId]/pin/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  const findings = await import("@/lib/analysis/findings");
  persistSegmentFindings = findings.persistSegmentFindings;
  listAllFindings = findings.listAllFindings;
  const cards = await import("@/lib/cards");
  generateCards = cards.generateCards;
  deleteCard = cards.deleteCard;
  listDueCards = cards.listDueCards;
});

afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const pinCtx = (findingId: string) => ({ params: Promise.resolve({ findingId }) });
const pinReq = () => new Request("http://localhost", { method: "POST" });

let seq = 0;
function seed(sessionId: string, n: number) {
  createSession(getDb(), { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  for (let i = 0; i < n; i++) {
    persistSegmentFindings(getDb(), {
      sessionId,
      contentHash: `${sessionId}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [
        { quote: `q${i}`, correction: `c${i}`, category: "grammar", explanation: `e${i}`, severity: "high", startMs: i * 1000, endMs: i * 1000 + 500 },
      ],
    });
  }
}

async function getEntries(): Promise<PhrasebookEntry[]> {
  return (await (await phrasebookGET()).json()).entries as PhrasebookEntry[];
}

describe("GET /api/phrasebook", () => {
  it("lists entries from every session with both sides and an in-deck flag", async () => {
    seed("s1", 2);
    seed("s2", 1);
    // listAllFindings sees all three across sessions.
    expect(listAllFindings(getDb())).toHaveLength(3);

    const entries = await getEntries();
    expect(entries).toHaveLength(3);
    const e = entries[0];
    expect(e).toHaveProperty("quote"); // what you said
    expect(e).toHaveProperty("correction"); // the native recast
    expect(entries.every((x) => x.inDeck === false)).toBe(true); // no cards yet
  });

  it("marks an entry in-deck once a card exists for its finding", async () => {
    seed("d", 1);
    generateCards(getDb()); // v0.1 auto-generates a card per finding
    const entries = await getEntries();
    expect(entries[0].inDeck).toBe(true);
  });
});

describe("POST /api/phrasebook/[findingId]/pin", () => {
  it("creates exactly one card, is idempotent, and lands the card in the due queue", async () => {
    seed("pin", 1);
    const findingId = listAllFindings(getDb())[0].id;

    const res = await pinPOST(pinReq(), pinCtx(findingId));
    expect(res.status).toBe(200);
    expect((await res.json()).inDeck).toBe(true);

    // Idempotent: a second pin does not duplicate the card.
    await pinPOST(pinReq(), pinCtx(findingId));
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n).toBe(1);
    expect(listDueCards(getDb()).map((c) => c.findingId)).toEqual([findingId]);
  });

  it("un-tombstones a previously-deleted finding so it returns to the deck", async () => {
    seed("back", 1);
    generateCards(getDb());
    const findingId = listAllFindings(getDb())[0].id;
    deleteCard(getDb(), listDueCards(getDb())[0].id); // remove it (E-5b tombstone)
    expect(listDueCards(getDb())).toHaveLength(0);

    const res = await pinPOST(pinReq(), pinCtx(findingId));
    expect(res.status).toBe(200);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM deleted_findings").get() as { n: number }).n).toBe(0);
    expect(listDueCards(getDb()).map((c) => c.findingId)).toEqual([findingId]);
  });

  it("404s an unknown finding", async () => {
    expect((await pinPOST(pinReq(), pinCtx("no-such-finding"))).status).toBe(404);
  });
});
