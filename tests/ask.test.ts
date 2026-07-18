import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import type { Db } from "@/lib/db";
import type { TextModelClient } from "@/lib/lessons/text-model";

// E-23 Ask Erika ask-once engine (D-13: the text-model client is mocked; no test
// makes a network call). Covers: ask once → exactly one model call, one ledger row,
// one note row that STRUCTURALLY cites ≥1 other real included finding; re-open →
// zero further calls or rows; the lease-before-spend ordering so a concurrent
// double-ask makes exactly ONE provider call and bills once (the loser calls
// nothing — D-15); the budget cap refusing truthfully with no call and no surviving
// row; the "no other finding to cite" refusal before any spend; and the FK cascade.

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let listSessionFindings: typeof import("@/lib/findings-model").listSessionFindings;
let getIncludedFinding: typeof import("@/lib/findings-model").getIncludedFinding;
let askFinding: typeof import("@/lib/ask/engine").askFinding;
let canAsk: typeof import("@/lib/ask/engine").canAsk;
let estimateUsd: typeof import("@/lib/ask/engine").estimateUsd;
let BudgetExceededError: typeof import("@/lib/ask/engine").BudgetExceededError;
let NoCorpusToCiteError: typeof import("@/lib/ask/engine").NoCorpusToCiteError;
let getCompletedNote: typeof import("@/lib/ask/notes").getCompletedNote;
let parseAskResponse: typeof import("@/lib/ask/note-builder").parseAskResponse;
let writeSettings: typeof import("@/lib/settings").writeSettings;

let dbSeq = 0;
function freshDb(): Db {
  const p = path.join(root, `db-${dbSeq++}.sqlite`);
  return openDatabase(p);
}

/** A mock text client that counts calls and cites the first candidate id it sees
 *  in the prompt — exercising the real model-cited path, not just the fallback. */
function mockClient(): TextModelClient & { calls: number } {
  const c = {
    calls: 0,
    async complete({ prompt }: { prompt: string; maxOutputTokens: number }) {
      c.calls++;
      const m = prompt.match(/\[([^\]]+)\]/);
      const cites = m ? [m[1]] : [];
      return {
        text: JSON.stringify({
          note: "Italian nouns carry grammatical gender, so the article and adjective must agree; you keep defaulting to the masculine form.",
          cites,
        }),
        promptTokens: 120,
        completionTokens: 60,
      };
    },
  };
  return c;
}

/** Seed one included finding in its own session; returns it. */
function seedFinding(db: Db, sessionId: string, correction: string, category = "grammar" as const) {
  createSession(db, { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  persistSegmentFindings(db, {
    sessionId,
    contentHash: `${sessionId}-hash`,
    flagged: true,
    deepDone: true,
    findings: [
      { quote: `quote-${sessionId}`, correction, category, explanation: "gender", severity: "high", startMs: 1000, endMs: 1500 },
    ],
  });
  return getIncludedFinding(db, listSessionFindings(db, sessionId)[0].id)!;
}

/** A corpus of ≥2 findings so there is always an OTHER finding to cite. */
function seedCorpus(db: Db) {
  const target = seedFinding(db, "s-target", "un problema");
  seedFinding(db, "s-other", "una cosa");
  return target;
}

function ledgerCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
}
function noteCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM ask_notes").get() as { n: number }).n;
}

beforeAll(async () => {
  root = tmpDir("erika-ask-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  const fm = await import("@/lib/findings-model");
  listSessionFindings = fm.listSessionFindings;
  getIncludedFinding = fm.getIncludedFinding;
  const engine = await import("@/lib/ask/engine");
  askFinding = engine.askFinding;
  canAsk = engine.canAsk;
  estimateUsd = engine.estimateUsd;
  BudgetExceededError = engine.BudgetExceededError;
  NoCorpusToCiteError = engine.NoCorpusToCiteError;
  getCompletedNote = (await import("@/lib/ask/notes")).getCompletedNote;
  parseAskResponse = (await import("@/lib/ask/note-builder")).parseAskResponse;
  writeSettings = (await import("@/lib/settings")).writeSettings;
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("ask-once engine", () => {
  it("asks once: one call, one ledger row, one note row that cites a real other finding", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    const client = mockClient();

    const out = await askFinding(db, client, target);
    expect(out.generated).toBe(true);
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(noteCount(db)).toBe(1);
    expect(out.note!.note.length).toBeGreaterThan(0);

    // The citation is STRUCTURAL (≥1) and resolves to a real included OTHER finding.
    expect(out.note!.citedIds.length).toBeGreaterThanOrEqual(1);
    for (const id of out.note!.citedIds) {
      expect(id).not.toBe(target.id);
      expect(getIncludedFinding(db, id)).not.toBeNull();
    }
    db.close();
  });

  it("re-opening is free: N re-opens add zero calls and zero rows", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    const client = mockClient();

    await askFinding(db, client, target);
    for (let i = 0; i < 4; i++) {
      const out = await askFinding(db, client, target);
      expect(out.generated).toBe(false);
      expect(out.note!.note.length).toBeGreaterThan(0);
    }
    expect(client.calls).toBe(1);
    expect(ledgerCount(db)).toBe(1);
    expect(noteCount(db)).toBe(1);
    db.close();
  });

  it("a concurrent double-ask makes ONE provider call and bills once (lease-before-spend)", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    const client = mockClient();

    const [a, b] = await Promise.all([askFinding(db, client, target), askFinding(db, client, target)]);
    // Exactly one request won the finding_id lease, called the provider, and billed;
    // the loser made ZERO provider call. The money-path invariant (D-15): recorded
    // spend == actual spend even under concurrent Ask. (Pre-repair, the call would
    // happen before the claim and both would race — this assertion catches that.)
    expect(client.calls).toBe(1);
    expect([a.generated, b.generated].filter(Boolean)).toHaveLength(1);
    expect(ledgerCount(db)).toBe(1);
    expect(noteCount(db)).toBe(1);
    // The finished note is complete and cites a real other finding.
    const note = getCompletedNote(db, target.id)!;
    expect(note.citedIds.length).toBeGreaterThanOrEqual(1);
    expect(getIncludedFinding(db, note.citedIds[0])).not.toBeNull();
    db.close();
  });

  it("the losing racer makes zero provider call and bills nothing", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    const client = mockClient();

    const first = await askFinding(db, client, target);
    expect(first.generated).toBe(true);
    expect(client.calls).toBe(1);

    const loser = await askFinding(db, client, target);
    expect(loser.generated).toBe(false);
    expect(client.calls).toBe(1); // no extra call
    expect(ledgerCount(db)).toBe(1); // no extra ledger row
    expect(noteCount(db)).toBe(1);
    db.close();
  });

  it("the budget cap refuses truthfully: no model call, no ledger row, no note row", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    writeSettings(db, { monthlyBudgetUsd: 0 });
    const client = mockClient();

    await expect(askFinding(db, client, target)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(client.calls).toBe(0);
    expect(ledgerCount(db)).toBe(0);
    expect(noteCount(db)).toBe(0);
    expect(getCompletedNote(db, target.id)).toBeNull();
    db.close();
  });

  it("refuses before any spend when there is no other finding to cite", async () => {
    const db = freshDb();
    const lonely = seedFinding(db, "s-lonely", "un problema");
    const client = mockClient();

    expect(canAsk(db, lonely)).toBe(false);
    await expect(askFinding(db, client, lonely)).rejects.toBeInstanceOf(NoCorpusToCiteError);
    expect(client.calls).toBe(0);
    expect(ledgerCount(db)).toBe(0);
    expect(noteCount(db)).toBe(0);
    db.close();
  });

  it("estimate is positive and canAsk is true when a corpus exists", () => {
    const db = freshDb();
    const target = seedCorpus(db);
    expect(canAsk(db, target)).toBe(true);
    expect(estimateUsd(db, target)).toBeGreaterThan(0);
    db.close();
  });
});

describe("parseAskResponse: the structural-citation guarantee", () => {
  it("keeps a valid model-cited id and drops a hallucinated one", () => {
    const candidates = [
      { id: "real-1", quote: "q", correction: "c", category: "grammar" },
      { id: "real-2", quote: "q", correction: "c", category: "grammar" },
    ] as never;
    const parsed = parseAskResponse(JSON.stringify({ note: "n", cites: ["real-2", "ghost"] }), candidates);
    expect(parsed.citedIds).toEqual(["real-2"]);
  });

  it("falls back to the top candidate when the model cites none — never zero cites", () => {
    const candidates = [{ id: "real-1", quote: "q", correction: "c", category: "grammar" }] as never;
    const parsed = parseAskResponse(JSON.stringify({ note: "n", cites: [] }), candidates);
    expect(parsed.citedIds).toEqual(["real-1"]);
  });
});

describe("migration v13 ask_notes", () => {
  it("has the finding_id/note/cited_ids/cost/created columns and cascades on finding delete", async () => {
    const db = freshDb();
    const target = seedCorpus(db);
    const client = mockClient();
    await askFinding(db, client, target);

    const cols = (db.prepare("PRAGMA table_info(ask_notes)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["finding_id", "note", "cited_ids", "cost_usd", "created_at"]));

    db.prepare("DELETE FROM sessions WHERE id = ?").run("s-target");
    expect(noteCount(db)).toBe(0);
    // Spend history survives the delete (money outlives sessions).
    expect(ledgerCount(db)).toBe(1);
    db.close();
  });
});
