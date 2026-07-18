import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { Db } from "@/lib/db";
import type { TtsModelClient } from "@/lib/render/tts-model";

// E-21 render-once engine (D-13: the TTS client is mocked; no test makes a network
// call). Covers: render once → exactly one model call, one ledger row, one
// rendition row, a file on disk; replay → zero further calls or rows; the
// INSERT-first guard so a concurrent double-generate cannot double-bill; the budget
// cap refusing truthfully with no call and no row; migration v12 shape and its FK
// cascade; and deletion coherence (row cascades, the file is orphan-safe).

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let getIncludedFinding: typeof import("@/lib/findings-model").getIncludedFinding;
let renderCorrection: typeof import("@/lib/render/engine").renderCorrection;
let renditionEstimateUsd: typeof import("@/lib/render/engine").renditionEstimateUsd;
let BudgetExceededError: typeof import("@/lib/render/engine").BudgetExceededError;
let getRendition: typeof import("@/lib/render/renditions").getRendition;
let insertRendition: typeof import("@/lib/render/renditions").insertRendition;
let renditionPathsForSession: typeof import("@/lib/render/renditions").renditionPathsForSession;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let ttsCallCost: typeof import("@/lib/analysis/rates").ttsCallCost;
let TTS_MODEL: typeof import("@/lib/analysis/rates").TTS_MODEL;

let dbSeq = 0;
function freshDb(): Db {
  const p = path.join(root, `db-${dbSeq++}.sqlite`);
  return openDatabase(p);
}

/** A mock TTS client that counts calls and returns tiny fake mp3 bytes. */
function mockClient(): TtsModelClient & { calls: number } {
  const c = {
    calls: 0,
    async synthesize() {
      c.calls++;
      return { audio: Buffer.from("ID3-fake-mp3-bytes"), format: "mp3" };
    },
  };
  return c;
}

function seedFinding(db: Db, sessionId: string, correction = "un problema") {
  createSession(db, { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(db, {
    sessionId,
    contentHash: `${sessionId}-hash`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: "una problema", correction, category: "grammar", explanation: "gender", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
  return getIncludedFinding(db, listOneFindingId(db, sessionId))!;
}

function listOneFindingId(db: Db, sessionId: string): string {
  return (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
}

function ledgerCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE model = ?").get(TTS_MODEL) as { n: number }).n;
}
function renditionCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM renditions").get() as { n: number }).n;
}

beforeAll(async () => {
  root = tmpDir("erika-render-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  getIncludedFinding = (await import("@/lib/findings-model")).getIncludedFinding;
  const engine = await import("@/lib/render/engine");
  renderCorrection = engine.renderCorrection;
  renditionEstimateUsd = engine.renditionEstimateUsd;
  BudgetExceededError = engine.BudgetExceededError;
  const renditions = await import("@/lib/render/renditions");
  getRendition = renditions.getRendition;
  insertRendition = renditions.insertRendition;
  renditionPathsForSession = renditions.renditionPathsForSession;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  const rates = await import("@/lib/analysis/rates");
  ttsCallCost = rates.ttsCallCost;
  TTS_MODEL = rates.TTS_MODEL;
});

afterEach(() => {
  fs.rmSync(path.join(root, "renditions"), { recursive: true, force: true });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("render-once engine", () => {
  it("renders once: one call, one ledger row, one rendition row, a file on disk", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s1");
    const client = mockClient();

    const out = await renderCorrection(db, client, finding);
    expect(out.generated).toBe(true);
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renditionCount(db)).toBe(1);
    expect(fs.existsSync(out.rendition.path)).toBe(true);
    expect(out.rendition.costUsd).toBeCloseTo(ttsCallCost(TTS_MODEL, finding.correction.length), 12);
    db.close();
  });

  it("replays are free: N replays add zero calls and zero rows", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s2");
    const client = mockClient();

    await renderCorrection(db, client, finding);
    for (let i = 0; i < 4; i++) {
      const out = await renderCorrection(db, client, finding);
      expect(out.generated).toBe(false);
    }
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renditionCount(db)).toBe(1);
    db.close();
  });

  it("a concurrent double-generate cannot double-bill (INSERT-first guard)", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s3");
    const client = mockClient();

    const [a, b] = await Promise.all([
      renderCorrection(db, client, finding),
      renderCorrection(db, client, finding),
    ]);
    // Exactly one transaction won the finding_id row and recorded the charge.
    expect([a.generated, b.generated].filter(Boolean)).toHaveLength(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renditionCount(db)).toBe(1);
    db.close();
  });

  it("insertRendition is the guard: the second insert for a finding loses", () => {
    const db = freshDb();
    seedFinding(db, "s3b");
    const fid = listOneFindingId(db, "s3b");
    expect(insertRendition(db, { findingId: fid, path: "/x.mp3", costUsd: 0.001 })).toBe(true);
    expect(insertRendition(db, { findingId: fid, path: "/y.mp3", costUsd: 0.001 })).toBe(false);
    expect(renditionCount(db)).toBe(1);
    db.close();
  });

  it("the budget cap refuses truthfully: no model call, no ledger row, no rendition row", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s4");
    writeSettings(db, { monthlyBudgetUsd: 0 });
    const client = mockClient();

    await expect(renderCorrection(db, client, finding)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(client.calls).toBe(0);
    expect(ledgerCount(db)).toBe(0);
    expect(renditionCount(db)).toBe(0);
    expect(getRendition(db, finding.id)).toBeNull();
    db.close();
  });

  it("estimate matches the rates machinery", () => {
    expect(renditionEstimateUsd("un problema")).toBeCloseTo(ttsCallCost(TTS_MODEL, "un problema".length), 12);
  });
});

describe("migration v12 renditions", () => {
  it("has the finding_id/path/cost/created columns and cascades on finding delete", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s5");
    const client = mockClient();
    await renderCorrection(db, client, finding);

    const cols = (db.prepare("PRAGMA table_info(renditions)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["finding_id", "path", "cost_usd", "created_at"]));

    // Deleting the session cascades findings, hence the rendition row.
    db.prepare("DELETE FROM sessions WHERE id = ?").run("s5");
    expect(renditionCount(db)).toBe(0);
    db.close();
  });
});

describe("deletion coherence", () => {
  it("renditionPathsForSession returns the files to unlink, and the row cascades", async () => {
    const db = freshDb();
    const finding = seedFinding(db, "s6");
    const client = mockClient();
    const out = await renderCorrection(db, client, finding);

    const paths = renditionPathsForSession(db, "s6");
    expect(paths).toEqual([out.rendition.path]);

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s6");
    expect(getRendition(db, finding.id)).toBeNull();
    // The spend history survives the delete (money outlives sessions).
    expect(ledgerCount(db)).toBe(1);
    db.close();
  });
});
