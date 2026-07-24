import fs from "node:fs";
import path from "node:path";
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
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let drillKeyForFinding: typeof import("@/lib/pronunciation").drillKeyForFinding;

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
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  drillKeyForFinding = (await import("@/lib/pronunciation")).drillKeyForFinding;
});

afterEach(() => {
  delete process.env.AZURE_SPEECH_KEY;
  delete process.env.AZURE_SPEECH_REGION;
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ctx = (drillKey: string) => ({ params: Promise.resolve({ drillKey }) });

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
