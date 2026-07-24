import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { writeSettings } from "@/lib/settings";
import { monthToDateSpend, recordSpend } from "@/lib/analysis/budget";
import { TEXT_MODEL, textCallCost } from "@/lib/analysis/rates";
import { ensureLemmaItem, ensureRuleItem } from "@/lib/knowledge/items";
import { generateItemLesson, getItemLesson } from "@/lib/lessons/item-lessons";
import { BudgetExceededError } from "@/lib/lessons/billing";
import { TextModelParseError, type TextModelClient } from "@/lib/lessons/text-model";
import { loadSyllabus } from "@/lib/syllabus";

// WO criterion 3 (every money invariant, never-waivable) against a MOCK text client
// — no network: generation reserves-before-call and finalizes to actual, a cache
// hit makes ZERO calls and bills ZERO (one ledger row per generation, not per
// open), the cap refuses truthfully BEFORE any call, and a parse failure STILL
// ledgers the resolved call (E-16 defect 4). Both grammar and vocab items exercised.

const RULE_KEY = loadSyllabus().rules[0].key;
const RULE_ITEM = `rule:${RULE_KEY}`;
const LEMMA_ITEM = "lemma:casa#NOUN";

const GOOD_GRAMMAR = JSON.stringify({
  intro: "A short rule explanation for the fixture.",
  exercises: [
    { type: "multiple_choice", prompt: "Pick the correct one", options: ["casa", "kasa"], answerIndex: 0, answer: "casa", rationale: "c not k" },
    { type: "cloze", prompt: "li-____", answer: "bro", derivable: true, rationale: "syllable" },
    { type: "cloze", prompt: "ca-____", answer: "sa", derivable: true, rationale: "syllable" },
  ],
});
const GOOD_VOCAB = JSON.stringify({
  intro: "«casa» means home.",
  glossEn: "house",
  exercises: [
    { type: "multiple_choice", prompt: "Which means home?", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", rationale: "home" },
    { type: "cloze", prompt: "Torno a ____ stasera.", answer: "casa", derivable: true, rationale: "home" },
    { type: "cloze", prompt: "Sinonimo colto di 'abitazione': ____", answer: "casa", derivable: true, rationale: "home" },
  ],
});

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-item-lessons-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  const db = openDatabase(path.join(dir, "erika.db"));
  ensureRuleItem(db, RULE_KEY);
  ensureLemmaItem(db, "casa", "NOUN");
  return db;
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function mockClient(reply: string, usage = { promptTokens: 150, completionTokens: 320 }) {
  const calls: string[] = [];
  const client: TextModelClient = {
    async complete({ prompt }) {
      calls.push(prompt);
      return { text: reply, promptTokens: usage.promptTokens, completionTokens: usage.completionTokens };
    },
  };
  return { client, calls };
}

describe("item-lesson generation bills once, then caches free (criterion 3)", () => {
  for (const [name, itemId, reply] of [
    ["grammar", RULE_ITEM, GOOD_GRAMMAR],
    ["vocab", LEMMA_ITEM, GOOD_VOCAB],
  ] as const) {
    it(`${name}: generates once, ledgers one row, then serves cached with zero calls and zero bill`, async () => {
      const db = freshDb();

      const first = mockClient(reply);
      const r1 = await generateItemLesson(db, first.client, itemId);
      expect(r1.cached).toBe(false);
      expect(first.calls).toHaveLength(1);
      expect(r1.lesson!.exercises.length).toBeGreaterThanOrEqual(3);

      const spent = monthToDateSpend(db);
      expect(spent).toBeGreaterThan(0);
      const rows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
      expect(rows.n).toBe(1); // one ledger row per generation
      // The charge is the actual usage-derived cost, and it committed (no pending row left).
      const committed = db.prepare("SELECT state, cost_usd FROM spend_ledger").get() as { state: string; cost_usd: number };
      expect(committed.state).toBe("committed");
      expect(committed.cost_usd).toBeCloseTo(textCallCost(TEXT_MODEL, 150, 320), 12);

      const second = mockClient(reply);
      const r2 = await generateItemLesson(db, second.client, itemId);
      expect(r2.cached).toBe(true);
      expect(second.calls).toHaveLength(0); // cache hit — no model call
      expect(monthToDateSpend(db)).toBe(spent); // ledger unchanged — cache re-open bills ZERO
      expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(1);
      db.close();
    });
  }
});

describe("[T1] lease-before-call: a concurrent double-generate makes ONE call, bills ONCE", () => {
  // The never-waivable money invariant (D-15): recorded spend == actual spend even
  // under concurrent same-item opens. Pre-repair, both racers reserved+called+were
  // charged, but the loser's PK conflict rolled back its finalize, so its real charge
  // was swept to $0 (recorded < actual). This mirrors the ask_notes concurrent test.
  for (const [name, itemId, reply] of [
    ["grammar", RULE_ITEM, GOOD_GRAMMAR],
    ["vocab", LEMMA_ITEM, GOOD_VOCAB],
  ] as const) {
    it(`${name}: two concurrent generates → exactly one model call and one committed ledger row`, async () => {
      const db = freshDb();
      // ONE shared mock client so the call count is the true number of provider calls
      // across BOTH racers (the lease must let exactly one through).
      const calls: string[] = [];
      const client: TextModelClient = {
        async complete({ prompt }) {
          calls.push(prompt);
          // Yield a microtask so the second racer runs its claim before we resolve —
          // the loser must see the claim and bail without a call.
          await Promise.resolve();
          return { text: reply, promptTokens: 150, completionTokens: 320 };
        },
      };

      const [a, b] = await Promise.all([
        generateItemLesson(db, client, itemId),
        generateItemLesson(db, client, itemId),
      ]);

      expect(calls).toHaveLength(1); // exactly one provider call won the lease
      expect([a.cached, b.cached].filter((c) => c === false)).toHaveLength(1); // one winner
      const rows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
      expect(rows.n).toBe(1); // one committed ledger row (no swept-to-$0 phantom charge)
      const row = db.prepare("SELECT state FROM spend_ledger").get() as { state: string };
      expect(row.state).toBe("committed");
      // Exactly one item_lessons row, and it is the completed (non-empty body) lesson.
      const lessonRows = db.prepare("SELECT COUNT(*) AS n FROM item_lessons").get() as { n: number };
      expect(lessonRows.n).toBe(1);
      expect(getItemLesson(db, itemId)!.exercises.length).toBeGreaterThanOrEqual(3);
      db.close();
    });
  }
});

describe("the cap is hard and truthful (criterion 3, never-waivable)", () => {
  it("refuses generation BEFORE any call when audit spend would breach the shared cap", async () => {
    const db = freshDb();
    // A tiny cap already nearly consumed by an EARLIER AUDIO call — text spend counts
    // against the SAME monthly budget, so generation must refuse untried.
    writeSettings(db, { monthlyBudgetUsd: 0.002 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "audio", costUsd: 0.0015 });

    const { client, calls } = mockClient(GOOD_GRAMMAR);
    await expect(generateItemLesson(db, client, RULE_ITEM)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toHaveLength(0); // no call was made
    expect(getItemLesson(db, RULE_ITEM)).toBeNull(); // nothing persisted
    expect(monthToDateSpend(db)).toBeCloseTo(0.0015, 10); // no new ledger row
    db.close();
  });
});

describe("a parse failure still bills the resolved call (criterion 3, E-16 defect 4)", () => {
  it("persists no lesson but ledgers exactly one committed row at the real cost", async () => {
    const db = freshDb();
    const { client, calls } = mockClient("total garbage, not json");
    await expect(generateItemLesson(db, client, RULE_ITEM)).rejects.toBeInstanceOf(TextModelParseError);
    expect(calls).toHaveLength(1); // the call happened…
    expect(getItemLesson(db, RULE_ITEM)).toBeNull(); // …but no lesson was written
    const rows = db.prepare("SELECT model, state, cost_usd FROM spend_ledger").all() as {
      model: string;
      state: string;
      cost_usd: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].model).toBe(TEXT_MODEL);
    expect(rows[0].state).toBe("committed"); // finalized, not left pending
    expect(rows[0].cost_usd).toBeCloseTo(textCallCost(TEXT_MODEL, 150, 320), 12);
    db.close();
  });
});
