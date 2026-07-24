import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { tmpDir } from "./helpers";
import { execFileSync } from "node:child_process";

// E-37 the WHOLE optional scoring path through the real route: raw WAV bytes in →
// normalized to 16 kHz mono → measured → assessed → billed → stored → a feedback view
// out. Green unit tests over a dead feature is the canonical failure, so this drives
// the route itself, not just the orchestration.
//
// D-13: the ADAPTER is mocked module-wide (the same shape as the reading/render route
// tests mocking the TTS client) and answers from a committed synthetic fixture. No test
// makes a network call, and the sandbox has no key and no egress.

vi.mock("@/lib/pronunciation/azure", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/pronunciation/azure")>();
  // The fixture name is switched per test through this holder. Note the fixture module
  // is imported INSIDE `score` rather than in this factory: it imports this very module
  // (for the real parser), and resolving that from the factory would deadlock.
  const holder: { name: "clean" | "noisy" } = { name: "clean" };
  (globalThis as { __pronFixture?: typeof holder }).__pronFixture = holder;
  return {
    ...actual,
    azurePronunciationScorer: {
      id: "azure-pa-it-IT",
      isAvailable: () => true,
      async score(input: import("@/lib/pronunciation/scorer").PronunciationScoreInput) {
        const { createFixtureScorer } = await import("@/lib/pronunciation/fixture-scorer");
        return createFixtureScorer(holder.name).score(input);
      },
    },
  };
});

function useFixture(name: "clean" | "noisy") {
  (globalThis as { __pronFixture?: { name: string } }).__pronFixture!.name = name;
}

let root: string;
let drillPOST: typeof import("@/app/api/pronunciation/[drillKey]/route").POST;
let attemptAudioGET: typeof import("@/app/api/pronunciation/attempts/[attemptId]/audio/route").GET;
let getDb: typeof import("@/lib/db").getDb;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let drillKeyForFinding: typeof import("@/lib/pronunciation").drillKeyForFinding;
let writeSettings: typeof import("@/lib/settings").writeSettings;

const ctx = (drillKey: string) => ({ params: Promise.resolve({ drillKey }) });

/** A real 44.1 kHz stereo WAV — deliberately NOT the 16 kHz mono Azure needs, so the
 *  route's normalization is genuinely exercised. */
function browserishTake(dest: string, seconds = 2): Blob {
  execFileSync(
    "ffmpeg",
    ["-y", "-f", "lavfi", "-i", `sine=frequency=440:duration=${seconds}`, "-ac", "2", "-ar", "44100", dest],
    { stdio: "ignore" },
  );
  return new Blob([new Uint8Array(fs.readFileSync(dest))]);
}

let seq = 0;
function seedDrillKey(): string {
  const db = getDb();
  const sessionId = `scored-s${seq++}`;
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
        quote: "ho preso il caffè",
        correction: "Ho preso un caffè al bar",
        category: "pronunciation",
        explanation: "the open è",
        severity: "medium",
        startMs: 0,
        endMs: 2000,
      },
    ],
  });
  const id = (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
  return drillKeyForFinding(id);
}

beforeAll(async () => {
  root = tmpDir("erika-pron-scored-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  drillPOST = (await import("@/app/api/pronunciation/[drillKey]/route")).POST;
  attemptAudioGET = (await import("@/app/api/pronunciation/attempts/[attemptId]/audio/route")).GET;
  getDb = (await import("@/lib/db")).getDb;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  drillKeyForFinding = (await import("@/lib/pronunciation")).drillKeyForFinding;
  writeSettings = (await import("@/lib/settings")).writeSettings;
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("POST /api/pronunciation/[drillKey] — the full scored path", () => {
  it("normalizes the take, scores it, bills once, stores it, and returns the feedback view", async () => {
    useFixture("clean");
    writeSettings(getDb(), { monthlyBudgetUsd: 50 });
    const key = seedDrillKey();
    const bytes = browserishTake(path.join(root, "browserish.wav"));

    const res = await drillPOST(
      new Request("http://localhost", { method: "POST", body: bytes }),
      ctx(key),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attemptId: string;
      costUsd: number;
      scorerId: string;
      view: {
        retake: boolean;
        scores: { pronScore: number; passed: boolean } | null;
        words: { word: string; band: string; startMs: number; durationMs: number }[];
        notice: string;
      };
    };

    expect(body.view.retake).toBe(false);
    expect(body.view.scores!.pronScore).toBeCloseTo(93.4, 5);
    expect(body.view.scores!.passed).toBe(true);
    expect(body.view.words.map((w) => w.word)).toEqual(["ho", "preso", "un", "caffè", "al", "bar"]);
    expect(body.view.words[0].durationMs).toBeGreaterThan(0);
    expect(body.view.notice).toMatch(/thresholds are our own/i);
    expect(body.costUsd).toBeGreaterThan(0);

    // Exactly one committed ledger row for this assessment.
    const rows = getDb()
      .prepare("SELECT state, content_hash, cost_usd FROM spend_ledger")
      .all() as { state: string; content_hash: string; cost_usd: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("committed");
    expect(rows[0].content_hash).toBe(`pa:${body.attemptId}`);

    // The stored take really is 16 kHz mono — the normalization ran, not just passed
    // the browser's bytes through to a service that requires ≥16 kHz.
    const stored = path.join(root, "pronunciation", `${body.attemptId}.wav`);
    expect(fs.existsSync(stored)).toBe(true);
    const rate = execFileSync(
      "ffprobe",
      ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels", "-of", "csv=p=0", stored],
      { encoding: "utf8" },
    ).trim();
    expect(rate).toBe("16000,1");

    // And it streams back for word-slice playback.
    const audio = await attemptAudioGET(new Request("http://localhost"), {
      params: Promise.resolve({ attemptId: body.attemptId }),
    });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("content-type")).toBe("audio/wav");
  });

  it("a too-noisy take returns the re-record prompt and NO scores — but is still billed", async () => {
    useFixture("noisy");
    writeSettings(getDb(), { monthlyBudgetUsd: 50 });
    getDb().prepare("DELETE FROM spend_ledger").run();
    const key = seedDrillKey();
    const bytes = browserishTake(path.join(root, "noisy-in.wav"));

    const res = await drillPOST(new Request("http://localhost", { method: "POST", body: bytes }), ctx(key));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      view: { retake: boolean; retakeNotice: string; scores: unknown; words: unknown[] };
    };
    expect(body.view.retake).toBe(true);
    expect(body.view.retakeNotice).toMatch(/hard to hear/i);
    expect(body.view.scores).toBeNull();
    expect(body.view.words).toEqual([]);

    // Azure ran, so Azure billed — the ledger tells the truth even when the UI shows
    // no number.
    const rows = getDb().prepare("SELECT state FROM spend_ledger").all() as { state: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("committed");
  });

  it("refuses truthfully at the cap with 402 — no charge and no score", async () => {
    useFixture("clean");
    getDb().prepare("DELETE FROM spend_ledger").run();
    const before = (getDb().prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n;
    writeSettings(getDb(), { monthlyBudgetUsd: 0 });
    const key = seedDrillKey();
    const bytes = browserishTake(path.join(root, "capped.wav"));

    const res = await drillPOST(new Request("http://localhost", { method: "POST", body: bytes }), ctx(key));
    expect(res.status).toBe(402);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("budget_exceeded");
    expect(body.error.message).toMatch(/Nothing was charged and nothing was scored/i);

    expect(getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").all()).toEqual([{ n: 0 }]);
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n).toBe(before);
    writeSettings(getDb(), { monthlyBudgetUsd: 50 });
  });
});
