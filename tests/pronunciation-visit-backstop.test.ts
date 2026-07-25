import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// E-39 §B4 / RETRO-004 Tier 4 §24 — the server-side backstop the visit route lacked.
//
// A visit is PERMANENT: it retires a pronunciation correction from the daily plan for
// good, and it is that finding's ONLY retirement route (no card path). The "heard the
// correct line" half of the claim was enforced only by the client, and the route accepted
// a bare POST from anything. This invariant has already broken twice.
//
// The server cannot know audio reached anyone's ears. It CAN know whether hearing the line
// was possible, which is the premise the permanent write rests on — and this file asserts
// all three states, from the fixture: rendition present ⇒ accepted; no voice configured at
// all ⇒ accepted (else the finding loops forever); a server that CAN render on a drill
// nothing has ever rendered ⇒ refused.

let root: string;
let visitPOST: (req: Request, ctx: { params: Promise<{ drillKey: string }> }) => Promise<Response>;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let upsertSegment: typeof import("@/lib/segments").upsertSegment;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let getVisit: typeof import("@/lib/pronunciation/attempts").getVisit;
let drillKeyForFinding: typeof import("@/lib/pronunciation/types").drillKeyForFinding;
let insertPhraseRender: typeof import("@/lib/render/phrase-renders").insertPhraseRender;
let phraseHash: typeof import("@/lib/render/phrase-renders").phraseHash;

const KEY = "OPENAI_API_KEY";
let keyBefore: string | undefined;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "erika-visit-backstop-"));
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  keyBefore = process.env[KEY];
  visitPOST = (await import("@/app/api/pronunciation/[drillKey]/visit/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  upsertSegment = (await import("@/lib/segments")).upsertSegment;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  getVisit = (await import("@/lib/pronunciation/attempts")).getVisit;
  drillKeyForFinding = (await import("@/lib/pronunciation/types")).drillKeyForFinding;
  const renders = await import("@/lib/render/phrase-renders");
  insertPhraseRender = renders.insertPhraseRender;
  phraseHash = renders.phraseHash;
});

afterAll(() => {
  delete process.env.ERIKA_DB_PATH;
  delete process.env.ERIKA_DATA_DIR;
  if (keyBefore === undefined) delete process.env[KEY];
  else process.env[KEY] = keyBefore;
  fs.rmSync(root, { recursive: true, force: true });
});

const REFERENCE = "La casa è bella.";

/** One pronunciation finding, so a real drill resolves for its key. */
function seedFinding(id: string): string {
  const db = getDb();
  createSession(db, {
    id,
    originalFilename: `${id}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 60,
  });
  db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES (?, ?, 'done')").run(`j-${id}`, id);
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 1000, contentHash: `h-${id}` });
  persistSegmentFindings(db, {
    sessionId: id,
    contentHash: `h-${id}`,
    flagged: true,
    deepDone: true,
    findings: [
      {
        quote: REFERENCE,
        correction: REFERENCE,
        category: "pronunciation",
        explanation: "the final vowel",
        severity: "medium",
        startMs: 0,
        endMs: 500,
      },
    ],
  });
  return (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(id) as { id: string }).id;
}

const ctx = (drillKey: string) => ({ params: Promise.resolve({ drillKey }) });
const post = (drillKey: string) =>
  visitPOST(new Request("http://localhost/x", { method: "POST" }), ctx(drillKey));

describe("POST /api/pronunciation/[drillKey]/visit — the permanent write is checked server-side", () => {
  it("REFUSES a bare POST when this server could have played the line but never did", async () => {
    process.env[KEY] = "sk-not-a-real-key"; // a voice IS configured here
    const findingId = seedFinding("could-render");
    const drillKey = drillKeyForFinding(findingId);

    const res = await post(drillKey);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("line_not_heard");
    // Nothing was written: the drill is exactly where it was before the request.
    expect(getVisit(getDb(), drillKey)).toBeNull();
  });

  it("ACCEPTS it once the reference rendition exists — the line was playable here", async () => {
    process.env[KEY] = "sk-not-a-real-key";
    const findingId = seedFinding("rendered");
    const drillKey = drillKeyForFinding(findingId);
    // The cached phrase render is the server's evidence that the line can be played. The
    // register comes from settings; `colto` is the shipped default.
    insertPhraseRender(getDb(), {
      hash: phraseHash(REFERENCE, "colto"),
      text: REFERENCE,
      register: "colto",
      path: path.join(root, "render.mp3"),
      costUsd: 0,
    });

    const res = await post(drillKey);
    expect(res.status).toBe(200);
    expect(getVisit(getDb(), drillKey)?.cycles).toBe(1);
  });

  it("ACCEPTS it when NO voice is configured — else the finding loops forever", async () => {
    delete process.env[KEY]; // no voice can ever be rendered on this server
    const findingId = seedFinding("no-voice");
    const drillKey = drillKeyForFinding(findingId);

    const res = await post(drillKey);
    expect(res.status).toBe(200);
    expect(getVisit(getDb(), drillKey)?.cycles).toBe(1);
  });

  it("still refuses a key that is not a drill at all", async () => {
    delete process.env[KEY];
    const res = await post("finding:not-a-real-finding");
    expect(res.status).toBe(404);
  });
});
