import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";

// E-37 the routes. What a client can actually see and do, end to end, with the sandbox's
// real conditions: NO `AZURE_SPEECH_KEY` and no egress.
//
//   * the studio list works with no key at all — drills, guidance and the honest
//     `scoringAvailable: false`; the loop is not gated on the optional scorer;
//   * the drill status carries the correct target, the E-33 rendition price, what to
//     listen for, and the unscored notice;
//   * POSTing a take with no key is refused with a plain 503 — no upload kept, no
//     charge, no fabricated score;
//   * SECRET HYGIENE: no payload from any of these routes contains the key or even the
//     env var name, and neither does any client-reachable module.

let root: string;
let studioGET: typeof import("@/app/api/pronunciation/route").GET;
let drillGET: typeof import("@/app/api/pronunciation/[drillKey]/route").GET;
let drillPOST: typeof import("@/app/api/pronunciation/[drillKey]/route").POST;
let visitPOST: typeof import("@/app/api/pronunciation/[drillKey]/visit/route").POST;
let pinPOST: typeof import("@/app/api/phrasebook/[findingId]/pin/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let drillKeyForFinding: typeof import("@/lib/pronunciation").drillKeyForFinding;
let studioDrillPath: typeof import("@/lib/pronunciation").studioDrillPath;

const FAKE_KEY = "azure-key-that-must-never-be-served";

beforeAll(async () => {
  root = tmpDir("erika-pron-route-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
  studioGET = (await import("@/app/api/pronunciation/route")).GET;
  const drill = await import("@/app/api/pronunciation/[drillKey]/route");
  drillGET = drill.GET;
  drillPOST = drill.POST;
  visitPOST = (await import("@/app/api/pronunciation/[drillKey]/visit/route")).POST;
  pinPOST = (await import("@/app/api/phrasebook/[findingId]/pin/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  const pron = await import("@/lib/pronunciation");
  drillKeyForFinding = pron.drillKeyForFinding;
  studioDrillPath = pron.studioDrillPath;
});

afterEach(() => {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

// A route HANDLER receives its dynamic params already DECODED by Next, so this mirrors
// the framework's real contract for API routes.
const ctx = (drillKey: string) => ({ params: Promise.resolve({ drillKey }) });

// A PAGE does not: Next hands a page its params still percent-ENCODED. That asymmetry is
// exactly what hid a defect where every drill 404'd in the browser while every route test
// passed, so the encoded shape gets its own helper and its own assertions below.
const encodedPageParams = (drillKey: string) => Promise.resolve({ drillKey: encodeURIComponent(drillKey) });

let seq = 0;
function seedPronFinding(): string {
  const db = getDb();
  const sessionId = `route-s${seq++}`;
  createSession(db, {
    id: sessionId,
    originalFilename: `${sessionId}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 30,
  });
  persistSegmentFindings(db, {
    sessionId,
    contentHash: `${sessionId}-hash`,
    flagged: true,
    deepDone: true,
    findings: [
      {
        quote: "li gnocchi",
        correction: "Gli gnocchi sono buonissimi",
        category: "pronunciation",
        explanation: "the palatal lateral in gli",
        severity: "high",
        startMs: 0,
        endMs: 2000,
        notes: { pronunciation: "gli sounded like li" },
      },
    ],
  });
  return (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
}

describe("GET /api/pronunciation — the studio list works with no key", () => {
  it("serves drills and reports the optional scorer as unavailable, honestly", async () => {
    const findingId = seedPronFinding();
    const body = (await (await studioGET()).json()) as {
      scoringAvailable: boolean;
      drills: { drillKey: string; referenceText: string; lastScore: number | null }[];
      notice: string;
      thresholds: { good: number };
    };
    expect(body.scoringAvailable).toBe(false);
    expect(body.drills.map((d) => d.drillKey)).toContain(drillKeyForFinding(findingId));
    expect(body.drills[0].referenceText).toBe("Gli gnocchi sono buonissimi");
    expect(body.drills[0].lastScore).toBeNull();
    expect(body.notice).toMatch(/no labelled\s+Italian pronunciation corpus/i);
    expect(body.thresholds.good).toBeGreaterThan(0);
  });

  it("reports the scorer available once the operator supplies credentials", async () => {
    process.env.AZURE_SPEECH_KEY = FAKE_KEY;
    process.env.AZURE_SPEECH_REGION = "westeurope";
    const body = (await (await studioGET()).json()) as { scoringAvailable: boolean };
    expect(body.scoringAvailable).toBe(true);
  });
});

describe("GET /api/pronunciation/[drillKey]", () => {
  it("carries the correct target, the guidance, and the unscored notice", async () => {
    const findingId = seedPronFinding();
    const res = await drillGET(new Request("http://localhost"), ctx(drillKeyForFinding(findingId)));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      referenceText: string;
      suspect: string;
      guidance: { text: string; basis: string };
      renditionExists: boolean;
      renditionEstimateUsd: number;
      scoringAvailable: boolean;
      scoreEstimateUsd: number;
      maxSeconds: number;
      unscoredNotice: string;
    };
    expect(body.referenceText).toBe("Gli gnocchi sono buonissimi"); // the correction (D-18)
    expect(body.guidance.basis).toBe("flag");
    expect(body.guidance.text).toContain("gli sounded like li");
    expect(body.renditionExists).toBe(false);
    expect(body.renditionEstimateUsd).toBeGreaterThan(0);
    expect(body.scoringAvailable).toBe(false);
    expect(body.scoreEstimateUsd).toBeGreaterThan(0);
    expect(body.maxSeconds).toBe(30);
    expect(body.unscoredNotice).toMatch(/Nothing here is scored/i);
  });

  it("404s an unknown or non-pronunciation drill key", async () => {
    const res = await drillGET(new Request("http://localhost"), ctx("finding:nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("drill_not_found");
  });
});

describe("POST /api/pronunciation/[drillKey] — the optional scoring layer", () => {
  it("refuses plainly with no key: no charge, no score, and the take is not kept", async () => {
    const findingId = seedPronFinding();
    const wav = path.join(root, "post-take.wav");
    makeWav(wav, 2);
    const res = await drillPOST(
      new Request("http://localhost", { method: "POST", body: fs.readFileSync(wav) }),
      ctx(drillKeyForFinding(findingId)),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("scorer_unavailable");
    expect(body.error.message).toMatch(/no Azure Speech key is configured/i);
    // Nothing was billed, nothing was stored, and nothing was written to disk.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n).toBe(0);
    expect(fs.existsSync(path.join(root, "pronunciation"))).toBe(false);
  });
});

describe("POST /api/pronunciation/[drillKey]/visit — the no-key practice record", () => {
  it("records a completed loop with no key, no money and no score", async () => {
    const findingId = seedPronFinding();
    const key = drillKeyForFinding(findingId);
    const res = await visitPOST(new Request("http://localhost", { method: "POST" }), ctx(key));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { drillKey: string; cycles: number };
    expect(body.drillKey).toBe(key);
    expect(body.cycles).toBe(1);

    // Nothing billed, nothing scored, nothing claimed about how well it went.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n).toBe(0);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(0);

    // Repeating the loop is idempotent.
    await visitPOST(new Request("http://localhost", { method: "POST" }), ctx(key));
    const again = (await (
      await visitPOST(new Request("http://localhost", { method: "POST" }), ctx(key))
    ).json()) as { cycles: number };
    expect(again.cycles).toBe(3);
  });

  it("refuses a key that is not a real drill, so no row can be minted for one", async () => {
    const res = await visitPOST(new Request("http://localhost", { method: "POST" }), ctx("finding:nope"));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("drill_not_found");
  });
});

describe("POST /api/phrasebook/[findingId]/pin — a pronunciation recast is routed, not carded", () => {
  it("mints no card and points the learner at the drill that can practise it", async () => {
    const findingId = seedPronFinding();
    const res = await pinPOST(new Request("http://localhost", { method: "POST" }), {
      params: Promise.resolve({ findingId }),
    });
    expect(res.status).toBe(200); // being sent somewhere better is not an error
    const body = (await res.json()) as {
      inDeck: boolean;
      routedTo: string;
      studioPath: string;
      message: string;
    };
    expect(body.inDeck).toBe(false);
    expect(body.routedTo).toBe("studio");
    expect(body.studioPath).toBe(
      `/practice/learn/studio/${encodeURIComponent(drillKeyForFinding(findingId))}`,
    );
    expect(body.message).toMatch(/practise it in the studio/i);
    expect(body.message).not.toContain("!"); // calm, no apology, no error styling (D-24)

    // No card exists for it — the unanswerable "____ · pronunciation" is never minted.
    expect(
      (getDb().prepare("SELECT COUNT(*) AS n FROM cards WHERE finding_id = ?").get(findingId) as { n: number }).n,
    ).toBe(0);

    // And the path it hands back resolves to a real drill.
    const drill = await drillGET(new Request("http://localhost"), ctx(drillKeyForFinding(findingId)));
    expect(drill.status).toBe(200);
  });
});

describe("the drill page's param contract — Next hands PAGES an encoded key", () => {
  // [B1] The studio drill page double-encoded its param, so `finding:<id>` became
  // `finding%253A<id>` and EVERY drill rendered "That drill is no longer available." on
  // every path. 958 tests passed over it because route handlers get decoded params and
  // only pages get encoded ones — so a helper that feeds the decoded shape can never see
  // the page's real contract.

  it("the page decodes its param before use — the convention its sibling pages follow", () => {
    const src = readFileSync(
      join(process.cwd(), "app/practice/learn/studio/[drillKey]/page.tsx"),
      "utf8",
    );
    expect(src).toContain("decodeURIComponent(rawDrillKey)");
  });

  it("a key in the shape Next really delivers round-trips to a resolvable drill", async () => {
    const findingId = seedPronFinding();
    const key = drillKeyForFinding(findingId);

    // What the studio list puts in the href, and what the page therefore receives.
    const href = studioDrillPath(key);
    expect(href).toContain("finding%3A");
    const { drillKey: asDelivered } = await encodedPageParams(key);
    expect(asDelivered).not.toBe(key); // it really is encoded

    // Decoding once — what the page now does — yields the key the API accepts.
    const decoded = decodeURIComponent(asDelivered);
    expect(decoded).toBe(key);
    const ok = await drillGET(new Request("http://localhost"), ctx(decoded));
    expect(ok.status).toBe(200);

    // Encoding it AGAIN — the defect — is what the API rejects.
    const doubled = encodeURIComponent(asDelivered);
    expect(doubled).toContain("%253A");
    const dead = await drillGET(new Request("http://localhost"), ctx(doubled));
    expect(dead.status).toBe(404);
  });

  it("the visit route is reachable with the decoded key and dead with a double-encoded one", async () => {
    const findingId = seedPronFinding();
    const key = drillKeyForFinding(findingId);
    const encodedOnce = (await encodedPageParams(key)).drillKey;

    expect(
      (await visitPOST(new Request("http://localhost", { method: "POST" }), ctx(decodeURIComponent(encodedOnce))))
        .status,
    ).toBe(200);
    expect(
      (await visitPOST(new Request("http://localhost", { method: "POST" }), ctx(encodeURIComponent(encodedOnce))))
        .status,
    ).toBe(404);
  });
});

describe("secret hygiene — the key is never client-reachable (criterion 6)", () => {
  it("no route payload contains the key or its variable name", async () => {
    process.env.AZURE_SPEECH_KEY = FAKE_KEY;
    process.env.AZURE_SPEECH_REGION = "westeurope";
    const findingId = seedPronFinding();

    const studio = await (await studioGET()).text();
    const drill = await (
      await drillGET(new Request("http://localhost"), ctx(drillKeyForFinding(findingId)))
    ).text();

    for (const payload of [studio, drill]) {
      expect(payload).not.toContain(FAKE_KEY);
      expect(payload).not.toContain("AZURE_SPEECH_KEY");
      expect(payload).not.toContain("westeurope");
      expect(payload).not.toMatch(/Ocp-Apim-Subscription-Key/i);
    }
  });

  it("no client component or hook reads AZURE_SPEECH_* — only server modules do", () => {
    const roots = ["app", "components", "lib"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const src = fs.readFileSync(p, "utf8");
        if (!src.includes("AZURE_SPEECH")) continue;
        // A client component is any file carrying the "use client" directive. The key
        // may only be read in a server module (lib/pronunciation/azure.ts).
        if (/^\s*["']use client["']/m.test(src)) offenders.push(p);
      }
    };
    for (const r of roots) walk(path.join(process.cwd(), r));
    expect(offenders).toEqual([]);

    // And exactly ONE module READS the variable (an `env.AZURE_SPEECH_*` access, as
    // opposed to merely naming it in a comment): the server-only Azure adapter.
    const readers: string[] = [];
    const walkReaders = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walkReaders(p);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        if (/\benv\.AZURE_SPEECH_/.test(fs.readFileSync(p, "utf8"))) {
          readers.push(path.relative(process.cwd(), p));
        }
      }
    };
    for (const r of roots) walkReaders(path.join(process.cwd(), r));
    expect(readers).toEqual(["lib/pronunciation/azure.ts"]);
  });
});
