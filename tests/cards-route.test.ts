import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";

// The three card routes (E-5): POST generate (idempotent), GET the due queue, and
// POST grade (SM-2 persist, with 404/400 guards). Real DB under a throwaway dir;
// env is set before the lazy getDb() binds, as in the analysis-route test.

let root: string;
let generatePOST: typeof import("@/app/api/cards/generate/route").POST;
let cardsGET: typeof import("@/app/api/cards/route").GET;
let gradePOST: typeof import("@/app/api/cards/[id]/grade/route").POST;
let suspendPOST: typeof import("@/app/api/cards/[id]/suspend/route").POST;
let deleteDELETE: typeof import("@/app/api/cards/[id]/route").DELETE;
let exportGET: typeof import("@/app/api/cards/export/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;

beforeAll(async () => {
  root = tmpDir("erika-cards-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  generatePOST = (await import("@/app/api/cards/generate/route")).POST;
  cardsGET = (await import("@/app/api/cards/route")).GET;
  gradePOST = (await import("@/app/api/cards/[id]/grade/route")).POST;
  suspendPOST = (await import("@/app/api/cards/[id]/suspend/route")).POST;
  deleteDELETE = (await import("@/app/api/cards/[id]/route")).DELETE;
  exportGET = (await import("@/app/api/cards/export/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
});

afterEach(() => getDb().prepare("DELETE FROM sessions").run());
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const gradeReq = (grade: unknown) =>
  new Request("http://localhost", { method: "POST", body: JSON.stringify({ grade }) });
const suspendReq = (suspended: unknown) =>
  new Request("http://localhost", { method: "POST", body: JSON.stringify({ suspended }) });
const dueGET = () => cardsGET(new Request("http://localhost/api/cards?due=1"));
const allGET = () => cardsGET(new Request("http://localhost/api/cards"));

function seed(id: string, n: number) {
  createSession(getDb(), { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  for (let i = 0; i < n; i++) {
    persistSegmentFindings(getDb(), {
      sessionId: id,
      contentHash: `${id}-h${i}`,
      flagged: true,
      deepDone: true,
      findings: [
        { quote: `q${i}`, correction: `c${i}`, category: "grammar", explanation: `e${i}`, severity: "high", startMs: i * 1000, endMs: i * 1000 + 500 },
      ],
    });
  }
}

describe("POST /api/cards/generate", () => {
  it("creates one card per finding and is idempotent across calls", async () => {
    seed("gen", 3);
    expect((await (await generatePOST()).json()).created).toBe(3);
    expect((await (await generatePOST()).json()).created).toBe(0);
  });
});

describe("GET /api/cards?due=1", () => {
  it("returns the due cards and their count as a client-safe view", async () => {
    seed("due", 2);
    await generatePOST();
    const body = await (await dueGET()).json();
    expect(body.dueCount).toBe(2);
    expect(body.cards).toHaveLength(2);
    // The view carries the drill fields plus findingId (for the back's Compare
    // control, E-21) — no SM-2/session plumbing leaks out.
    expect(Object.keys(body.cards[0]).sort()).toEqual(["back", "category", "findingId", "front", "id"]);
  });
});

describe("POST /api/cards/[id]/grade", () => {
  it("grades a card, persists the SM-2 schedule, and drops it from the due queue", async () => {
    seed("grd", 1);
    await generatePOST();
    const card = (await (await dueGET()).json()).cards[0];

    const res = await gradePOST(gradeReq("good"), ctx(card.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schedule.repetitions).toBe(1);
    // FSRS-6 (E-25): a first Good schedules ≥1 day out (its exact interval is the
    // algorithm's, not SM-2's fixed 1); the route contract is that a pass leaves
    // the due queue (asserted below).
    expect(body.schedule.intervalDays).toBeGreaterThanOrEqual(1);
    expect(body.schedule.lastGrade).toBe("good");

    // A graded card is no longer due.
    expect((await (await dueGET()).json()).dueCount).toBe(0);
  });

  it("404s an unknown card and 400s an invalid grade", async () => {
    seed("bad", 1);
    await generatePOST();
    const card = (await (await dueGET()).json()).cards[0];
    expect((await gradePOST(gradeReq("good"), ctx("nope"))).status).toBe(404);
    expect((await gradePOST(gradeReq("brilliant"), ctx(card.id))).status).toBe(400);
  });
});

describe("GET /api/cards (browser: all cards)", () => {
  it("returns every card with due & suspended, unlike the due-only view", async () => {
    seed("all", 2);
    await generatePOST();
    const body = await (await allGET()).json();
    expect(body.cards).toHaveLength(2);
    expect(Object.keys(body.cards[0]).sort()).toEqual(["back", "category", "due", "front", "id", "suspended"]);
  });
});

describe("POST /api/cards/[id]/suspend", () => {
  it("suspends a card out of the due queue, unsuspends it back, and guards its input", async () => {
    seed("susp", 1);
    await generatePOST();
    const id = (await (await dueGET()).json()).cards[0].id;

    expect((await suspendPOST(suspendReq(true), ctx(id))).status).toBe(200);
    expect((await (await dueGET()).json()).dueCount).toBe(0); // out of the queue
    expect((await (await allGET()).json()).cards[0].suspended).toBe(true); // marked in the browser

    await suspendPOST(suspendReq(false), ctx(id));
    expect((await (await dueGET()).json()).dueCount).toBe(1); // restored

    expect((await suspendPOST(suspendReq(true), ctx("nope"))).status).toBe(404);
    expect((await suspendPOST(suspendReq("yes"), ctx(id))).status).toBe(400);
  });
});

describe("DELETE /api/cards/[id]", () => {
  it("removes a card, keeps it gone across regenerate, and 404s an unknown card", async () => {
    seed("del", 1);
    await generatePOST();
    const id = (await (await dueGET()).json()).cards[0].id;

    expect((await deleteDELETE(new Request("http://localhost", { method: "DELETE" }), ctx(id))).status).toBe(200);
    expect((await (await allGET()).json()).cards).toHaveLength(0); // gone from the browser
    await generatePOST(); // the finding still exists…
    expect((await (await allGET()).json()).cards).toHaveLength(0); // …but no card resurrects

    expect((await deleteDELETE(new Request("http://localhost", { method: "DELETE" }), ctx(id))).status).toBe(404);
  });
});

describe("GET /api/cards/export", () => {
  it("returns a downloadable CSV with the right headers and both fields escaped", async () => {
    seed("exp", 1);
    // A finding whose quote carries a comma, a quote, and a newline exercises escaping.
    persistSegmentFindings(getDb(), {
      sessionId: "exp",
      contentHash: "exp-nasty",
      flagged: true,
      deepDone: true,
      findings: [
        { quote: 'he said, "hi"\nthere', correction: "c", category: "grammar", explanation: "e", severity: "high", startMs: 0, endMs: 1 },
      ],
    });
    await generatePOST();

    const res = await exportGET();
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="erika-cards.csv"');
    const text = await res.text();
    expect(text).toContain('"he said, ""hi""\nthere"'); // RFC 4180 escaped in the body
  });
});
