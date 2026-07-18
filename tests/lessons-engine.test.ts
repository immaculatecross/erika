import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { writeSettings } from "@/lib/settings";
import { persistSegmentFindings, listAllFindings, type NewFinding } from "@/lib/analysis/findings";
import { monthToDateSpend, recordSpend } from "@/lib/analysis/budget";
import { TEXT_MODEL, textCallCost } from "@/lib/analysis/rates";
import { derivePatterns, type Pattern } from "@/lib/lessons/patterns";
import { generateLessonForPattern } from "@/lib/lessons/generate";
import { gradeRewrite } from "@/lib/lessons/grade";
import { getLessonByPattern } from "@/lib/lessons/lessons";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { TextModelParseError, type TextModelClient } from "@/lib/lessons/text-model";

// WO criteria 2 & 4 (engine halves) against a MOCK text client — no network:
// generation parses & persists, a malformed reply writes nothing, the budget cap
// refuses before billing (no call, no ledger row), every real call records into
// the SHARED spend_ledger, a cached lesson makes zero new calls, and grading bills.

const GOOD_LESSON = JSON.stringify({
  explanation: "Age uses the verb 'to be', not 'to have'.",
  exercises: [
    { type: "multiple_choice", prompt: "Pick", options: ["I am 25", "I have 25"], answerIndex: 0 },
    { type: "fill_in", prompt: "I ___ 25 years old", answer: "am" },
    { type: "rewrite", prompt: "Rewrite: I have 25 years", target: "I am 25 years old" },
  ],
});

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-lessons-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a session with `n` grammar findings → exactly one derivable pattern. */
function seedPattern(db: Db, n = 3): Pattern {
  createSession(db, { id: "s1", originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
  const findings: NewFinding[] = Array.from({ length: n }, (_, i) => ({
    quote: `mistake ${i}`,
    correction: `fix ${i}`,
    category: "grammar",
    explanation: "why",
    severity: "low",
    startMs: i * 1000,
    endMs: i * 1000 + 500,
  }));
  persistSegmentFindings(db, { sessionId: "s1", contentHash: "h", flagged: true, deepDone: true, findings });
  const patterns = derivePatterns(listAllFindings(db));
  expect(patterns).toHaveLength(1);
  return patterns[0];
}

function mockClient(reply: string, usage = { promptTokens: 120, completionTokens: 240 }) {
  const calls: string[] = [];
  const client: TextModelClient = {
    async complete({ prompt }) {
      calls.push(prompt);
      return { text: reply, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
    },
  };
  return { client, calls };
}

describe("lesson generation persists & caches (criteria 2, 4)", () => {
  it("generates once, records spend into the shared ledger, then serves cached with zero calls", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);

    const first = mockClient(GOOD_LESSON);
    const r1 = await generateLessonForPattern(db, first.client, pattern);
    expect(r1.cached).toBe(false);
    expect(first.calls).toHaveLength(1);
    expect(r1.lesson.exercises.map((e) => e.type)).toEqual(["multiple_choice", "fill_in", "rewrite"]);

    const spent = monthToDateSpend(db);
    expect(spent).toBeGreaterThan(0); // real call billed the shared ledger
    const ledgerRows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
    expect(ledgerRows.n).toBe(1);

    const second = mockClient(GOOD_LESSON);
    const r2 = await generateLessonForPattern(db, second.client, pattern);
    expect(r2.cached).toBe(true);
    expect(second.calls).toHaveLength(0); // cache hit — no model call
    expect(monthToDateSpend(db)).toBe(spent); // ledger unchanged
    db.close();
  });

  // E-16 defect 4 (was: "...and records no spend"). The call RESOLVED, so OpenAI
  // charged for it; only the parse failed. Recording nothing here meant the retry
  // billed again while the cap counted only the money we had managed to parse.
  it("a malformed reply persists no lesson but STILL ledgers the resolved call", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);
    const { client, calls } = mockClient("total garbage, not json");
    await expect(generateLessonForPattern(db, client, pattern)).rejects.toBeInstanceOf(TextModelParseError);
    expect(calls).toHaveLength(1); // the call happened...
    expect(getLessonByPattern(db, pattern.key)).toBeNull(); // ...but no lesson was written
    // ...and the charge is on the ledger, at the call's real usage-derived cost.
    const rows = db.prepare("SELECT model, cost_usd FROM spend_ledger").all() as {
      model: string;
      cost_usd: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe(TEXT_MODEL);
    expect(rows[0].cost_usd).toBeCloseTo(textCallCost(TEXT_MODEL, 120, 240), 12);
    expect(monthToDateSpend(db)).toBeGreaterThan(0);
    db.close();
  });

  it("a malformed GRADE reply also ledgers its resolved call (defect 4, both engines)", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);
    const { client, calls } = mockClient("not json either");
    await expect(
      gradeRewrite(db, client, { patternKey: pattern.key, target: "I am 25", rewrite: "I have 25" }),
    ).rejects.toBeInstanceOf(TextModelParseError);
    expect(calls).toHaveLength(1);
    const rows = db.prepare("SELECT content_hash, cost_usd FROM spend_ledger").all() as {
      content_hash: string;
      cost_usd: number;
    }[];
    expect(rows).toHaveLength(1); // exactly one — not double-recorded
    expect(rows[0].content_hash).toBe(`grade:${pattern.key}`);
    expect(rows[0].cost_usd).toBeCloseTo(textCallCost(TEXT_MODEL, 120, 240), 12);
    db.close();
  });
});

describe("budget cap refuses before billing (criterion 4)", () => {
  it("refuses generation before any call when audit spend would breach the shared cap", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);
    // A tiny cap already nearly consumed by an EARLIER AUDIO call — text spend
    // counts against the SAME monthly budget, so generation must refuse untried.
    writeSettings(db, { monthlyBudgetUsd: 0.002 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "audio", costUsd: 0.0015 });

    const { client, calls } = mockClient(GOOD_LESSON);
    await expect(generateLessonForPattern(db, client, pattern)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0); // no call was made
    expect(getLessonByPattern(db, pattern.key)).toBeNull(); // nothing persisted
    expect(monthToDateSpend(db)).toBeCloseTo(0.0015, 10); // no new ledger row
    db.close();
  });
});

describe("rewrite grading bills the shared ledger (criterion 3)", () => {
  it("grades against a mock and records the call's cost", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);
    const { client, calls } = mockClient('{"correct":false,"feedback":"Age takes to be."}');
    const res = await gradeRewrite(db, client, { patternKey: pattern.key, target: "I am 25", rewrite: "I have 25" });
    expect(res).toEqual({ correct: false, feedback: "Age takes to be." });
    expect(calls).toHaveLength(1);
    expect(monthToDateSpend(db)).toBeGreaterThan(0);
    db.close();
  });

  it("refuses grading before billing when the cap is already reached", async () => {
    const db = freshDb();
    const pattern = seedPattern(db);
    writeSettings(db, { monthlyBudgetUsd: 0.001 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "audio", costUsd: 0.001 });
    const { client, calls } = mockClient('{"correct":true,"feedback":"ok"}');
    await expect(
      gradeRewrite(db, client, { patternKey: pattern.key, target: "t", rewrite: "r" }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0);
    expect(monthToDateSpend(db)).toBeCloseTo(0.001, 10);
    db.close();
  });
});
