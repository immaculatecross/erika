import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { Db } from "@/lib/db";
import type { TtsModelClient } from "@/lib/render/tts-model";

// E-33 criterion 2/4: the phrase render engine reuses the ONE E-21 biller
// (reserve-before-call, per-phrase cache, ledger). D-13: the TTS client is mocked;
// no test makes a network call. Covers: render once → one call, one ledger row, one
// phrase_renders row, a file on disk; replay → zero calls/rows; concurrent double →
// one provider call (lease-before-spend, D-15); the budget cap refusing truthfully;
// the cache keyed by register (a different register re-renders); migration v21 shape.

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let renderPhrase: typeof import("@/lib/render/phrase").renderPhrase;
let phraseRenderEstimateUsd: typeof import("@/lib/render/phrase").phraseRenderEstimateUsd;
let BudgetExceededError: typeof import("@/lib/render/engine").BudgetExceededError;
let getPhraseRender: typeof import("@/lib/render/phrase-renders").getPhraseRender;
let phraseHash: typeof import("@/lib/render/phrase-renders").phraseHash;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let ttsCallCost: typeof import("@/lib/analysis/rates").ttsCallCost;
let TTS_MODEL: typeof import("@/lib/analysis/rates").TTS_MODEL;

let dbSeq = 0;
function freshDb(): Db {
  return openDatabase(path.join(root, `db-${dbSeq++}.sqlite`));
}

function mockClient(): TtsModelClient & { calls: number; lastInstructions?: string } {
  const c = {
    calls: 0,
    lastInstructions: undefined as string | undefined,
    async synthesize(input: { text: string; instructions?: string }) {
      c.calls++;
      c.lastInstructions = input.instructions;
      return { audio: Buffer.from("ID3-fake-mp3-bytes"), format: "mp3" };
    },
  };
  return c;
}

function ledgerCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE model = ?").get(TTS_MODEL) as { n: number }).n;
}
function renderCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM phrase_renders").get() as { n: number }).n;
}

beforeAll(async () => {
  root = tmpDir("erika-phrase-render-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  const phrase = await import("@/lib/render/phrase");
  renderPhrase = phrase.renderPhrase;
  phraseRenderEstimateUsd = phrase.phraseRenderEstimateUsd;
  BudgetExceededError = (await import("@/lib/render/engine")).BudgetExceededError;
  const renders = await import("@/lib/render/phrase-renders");
  getPhraseRender = renders.getPhraseRender;
  phraseHash = renders.phraseHash;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  const rates = await import("@/lib/analysis/rates");
  ttsCallCost = rates.ttsCallCost;
  TTS_MODEL = rates.TTS_MODEL;
});

afterEach(() => {
  fs.rmSync(path.join(root, "phrase-renders"), { recursive: true, force: true });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const TEXT = "Nel mezzo del cammin di nostra vita";

describe("phrase render engine — one biller, per-phrase cache", () => {
  it("renders once: one call, one ledger row, one phrase row, a file on disk", async () => {
    const db = freshDb();
    const client = mockClient();
    const out = await renderPhrase(db, client, { text: TEXT, register: "colto" });
    expect(out.generated).toBe(true);
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renderCount(db)).toBe(1);
    expect(fs.existsSync(out.render.path)).toBe(true);
    expect(out.render.costUsd).toBeCloseTo(ttsCallCost(TTS_MODEL, TEXT.length), 12);
    // The register-aware TTS instruction was passed (D-23).
    expect(client.lastInstructions).toMatch(/Italian/);
    db.close();
  });

  it("replays are free: N replays add zero calls and zero rows", async () => {
    const db = freshDb();
    const client = mockClient();
    await renderPhrase(db, client, { text: TEXT, register: "colto" });
    for (let i = 0; i < 4; i++) {
      const out = await renderPhrase(db, client, { text: TEXT, register: "colto" });
      expect(out.generated).toBe(false);
    }
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renderCount(db)).toBe(1);
    db.close();
  });

  it("a concurrent double-render makes ONE provider call, bills once (lease-before-spend)", async () => {
    const db = freshDb();
    const client = mockClient();
    const [a, b] = await Promise.all([
      renderPhrase(db, client, { text: TEXT, register: "colto" }),
      renderPhrase(db, client, { text: TEXT, register: "colto" }),
    ]);
    expect(client.calls).toBe(1);
    expect([a.generated, b.generated].filter(Boolean)).toHaveLength(1);
    expect(ledgerCount(db)).toBe(1);
    expect(renderCount(db)).toBe(1);
    expect(a.render.path).toBe(b.render.path);
    db.close();
  });

  it("the budget cap refuses truthfully: no model call, no ledger row, no phrase row", async () => {
    const db = freshDb();
    writeSettings(db, { monthlyBudgetUsd: 0 });
    const client = mockClient();
    await expect(renderPhrase(db, client, { text: TEXT, register: "colto" })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(client.calls).toBe(0);
    expect(ledgerCount(db)).toBe(0);
    expect(renderCount(db)).toBe(0);
    expect(getPhraseRender(db, phraseHash(TEXT, "colto"))).toBeNull();
    db.close();
  });

  it("the cache key includes the register: a different register re-renders", async () => {
    const db = freshDb();
    const client = mockClient();
    await renderPhrase(db, client, { text: TEXT, register: "colto" });
    const other = await renderPhrase(db, client, { text: TEXT, register: "letterario" });
    expect(other.generated).toBe(true); // a distinct clip, not the colto cache hit
    expect(client.calls).toBe(2);
    expect(renderCount(db)).toBe(2);
    expect(phraseHash(TEXT, "colto")).not.toBe(phraseHash(TEXT, "letterario"));
    db.close();
  });

  it("estimate matches the rates machinery", () => {
    expect(phraseRenderEstimateUsd(TEXT)).toBeCloseTo(ttsCallCost(TTS_MODEL, TEXT.length), 12);
  });
});

describe("migration v21 phrase_renders", () => {
  it("has the hash/text/register/path/cost/created columns keyed by hash", async () => {
    const db = freshDb();
    const cols = db.prepare("PRAGMA table_info(phrase_renders)").all() as { name: string; pk: number }[];
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["hash", "text", "register", "path", "cost_usd", "created_at"]),
    );
    expect(cols.find((c) => c.name === "hash")?.pk).toBe(1);
    db.close();
  });
});
