import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { writeSettings } from "@/lib/settings";
import { monthToDateSpend, recordSpend } from "@/lib/analysis/budget";
import { TEXT_MODEL, textCallCost } from "@/lib/analysis/rates";
import { ensureLemmaItem, ensureRuleItem } from "@/lib/knowledge/items";
import {
  generateItemLesson,
  getItemLesson,
  lessonPreparationState,
  prepareItemLesson,
  sweepStaleItemLessonClaims,
} from "@/lib/lessons/item-lessons";
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
  intro: "La regola spiega come scegliere la forma corretta nelle frasi italiane.",
  examples: ["Sono andato a casa."],
  newWords: [],
  // [E-45] ONE exercise shape: options are mandatory on both invites, because a
  // spoken drill's options ARE its fallback when speech recognition fails.
  exercises: [
    { type: "choice", prompt: "Scegli la grafia corretta.", options: ["casa", "kasa"], answerIndex: 0, answer: "casa", invite: "click", rationale: "In italiano la parola casa si scrive con la c." },
    { type: "choice", prompt: "li-____", options: ["bro", "pro"], answerIndex: 0, answer: "bro", invite: "speak", rationale: "La sillaba completa correttamente la parola libro." },
    { type: "choice", prompt: "ca-____", options: ["sa", "za"], answerIndex: 0, answer: "sa", invite: "click", rationale: "La sillaba completa correttamente la parola casa." },
  ],
});
const GOOD_VOCAB = JSON.stringify({
  intro: "La casa è l'edificio o il luogo in cui una persona abita.",
  definition: "Edificio o luogo in cui si abita.",
  examples: ["Torno a casa stasera."],
  newWords: [{ lemma: "casa", definition: "Edificio o luogo in cui si abita." }],
  exercises: [
    { type: "choice", prompt: "Quale parola indica il luogo in cui si abita?", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", invite: "click", rationale: "Casa indica il luogo in cui si abita." },
    { type: "choice", prompt: "Torno a ____ stasera.", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", invite: "speak", rationale: "La locuzione corretta è tornare a casa." },
    { type: "choice", prompt: "Sinonimo comune di «abitazione»: ____", options: ["casa", "cassa"], answerIndex: 0, answer: "casa", invite: "click", rationale: "Casa può indicare un'abitazione." },
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

describe("one-lesson-ahead preparation resolves once and never strands a claim", () => {
  it("two concurrent home triggers make one provider call and one finalized charge", async () => {
    const db = freshDb();
    const calls: string[] = [];
    const client: TextModelClient = {
      async complete({ prompt }) {
        calls.push(prompt);
        await Promise.resolve();
        return { text: GOOD_GRAMMAR, promptTokens: 150, completionTokens: 320 };
      },
    };

    const [a, b] = await Promise.all([
      prepareItemLesson(db, client, RULE_ITEM),
      prepareItemLesson(db, client, RULE_ITEM),
    ]);

    expect(calls).toHaveLength(1);
    expect([a.state, b.state]).toEqual(expect.arrayContaining(["ready", "preparing"]));
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("ready");
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state = 'committed'").get() as { n: number }).n).toBe(1);
    expect((db.prepare("SELECT body FROM item_lessons WHERE item_id = ?").get(RULE_ITEM) as { body: string }).body.length).toBeGreaterThan(0);
    db.close();
  });

  it("uses one bounded language repair and caches the repaired Italian result", async () => {
    const db = freshDb();
    const english = JSON.stringify({
      ...JSON.parse(GOOD_GRAMMAR),
      intro: "The auxiliary is chosen according to the verb and the meaning of the sentence.",
    });
    const prompts: string[] = [];
    const client: TextModelClient = {
      async complete({ prompt }) {
        prompts.push(prompt);
        return {
          text: prompts.length === 1 ? english : GOOD_GRAMMAR,
          promptTokens: 150,
          completionTokens: 320,
        };
      },
    };

    const prepared = await prepareItemLesson(db, client, RULE_ITEM);
    expect(prepared.state).toBe("ready");
    expect(prepared.lesson?.deterministic).not.toBe(true);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("EVERY learner-visible value in Italian");
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state = 'committed'").get() as { n: number }).n).toBe(2);

    const reopened = mockClient(english);
    const again = await prepareItemLesson(db, reopened.client, RULE_ITEM);
    expect(again.cached).toBe(true);
    expect(reopened.calls).toHaveLength(0);
    db.close();
  });

  it("fills the claim with authored Italian after invalid output, so later reads never retry", async () => {
    const db = freshDb();
    const first = mockClient("not json");
    const prepared = await prepareItemLesson(db, first.client, RULE_ITEM);
    expect(first.calls).toHaveLength(1);
    expect(prepared.lesson?.deterministic).toBe(true);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("ready");
    expect((db.prepare("SELECT body FROM item_lessons WHERE item_id = ?").get(RULE_ITEM) as { body: string }).body.length).toBeGreaterThan(0);

    const later = mockClient(GOOD_GRAMMAR);
    await prepareItemLesson(db, later.client, RULE_ITEM);
    expect(later.calls).toHaveLength(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state = 'committed'").get() as { n: number }).n).toBe(1);
    db.close();
  });

  it("turns a no-charge network failure into authored Italian immediately", async () => {
    const db = freshDb();
    let calls = 0;
    const client: TextModelClient = {
      async complete() {
        calls++;
        throw new Error("network down");
      },
    };
    const prepared = await prepareItemLesson(db, client, RULE_ITEM);
    expect(calls).toBe(1);
    expect(prepared.lesson?.deterministic).toBe(true);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("ready");
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("turns a rejected API key into authored Italian without leaving a claim or charge", async () => {
    const db = freshDb();
    const client: TextModelClient = {
      async complete() {
        throw new Error("401 Unauthorized");
      },
    };
    const prepared = await prepareItemLesson(db, client, RULE_ITEM);
    expect(prepared.lesson?.deterministic).toBe(true);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("ready");
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("turns a hard-cap refusal into authored Italian without calling the provider", async () => {
    const db = freshDb();
    writeSettings(db, { monthlyBudgetUsd: 0.002 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "audio", costUsd: 0.0015 });
    const model = mockClient(GOOD_GRAMMAR);

    const prepared = await prepareItemLesson(db, model.client, RULE_ITEM);
    expect(model.calls).toHaveLength(0);
    expect(prepared.lesson?.deterministic).toBe(true);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("ready");
    expect(monthToDateSpend(db)).toBeCloseTo(0.0015, 10);
    db.close();
  });

  it("reclaims a crashed empty claim without touching completed lessons", async () => {
    const db = freshDb();
    db.prepare(
      "INSERT INTO item_lessons (item_id, kind, register, body, content_version, created_at) " +
        "VALUES (?, 'grammar', 'colto', '', 2, '2000-01-01 00:00:00')",
    ).run(RULE_ITEM);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("preparing");
    expect(sweepStaleItemLessonClaims(db)).toBe(1);
    expect(lessonPreparationState(db, RULE_ITEM)).toBe("needed");

    const prepared = await prepareItemLesson(db, null, RULE_ITEM);
    expect(prepared.lesson?.deterministic).toBe(true);
    expect(sweepStaleItemLessonClaims(db)).toBe(0);
    expect(getItemLesson(db, RULE_ITEM)).not.toBeNull();
    db.close();
  });
});
