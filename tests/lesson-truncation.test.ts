import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { ensureRuleItem } from "@/lib/knowledge/items";
import { pickTeachableRule } from "@/lib/lessons/syllabus-lesson";
import { generateItemLesson, getItemLesson, todaysLesson, ITEM_LESSON_MAX_OUTPUT_TOKENS } from "@/lib/lessons/item-lessons";
import { TextModelTruncatedError, wasTruncated, type TextCompletion, type TextModelClient } from "@/lib/lessons/text-model";
import {
  lessonOutputTokenCeiling,
  lessonRepairTokenCeiling,
  MAX_DRILLS,
  MAX_INTRO_WORDS,
  MAX_DRILL_WORDS,
} from "@/lib/lessons/lesson-budget";
import { drillIsUsable } from "@/lib/lessons/item-lessons-view";

// ─────────────────────────────────────────────────────────────────────────────
// E-45 — A BILLED GENERATION NEVER RESOLVES INTO NOTHING.
//
// The defect, found by driving the live API: an item-lesson call that RESOLVED,
// was BILLED, and produced no lesson. Not a network failure — the reply came back
// `finish_reason: "length"`, so it was half a JSON object; `extractJsonObject`
// failed on it, and the learner was told "the lesson model returned an unreadable
// response", which is not what happened and gives nobody anything to do.
//
// Reproduced against the real API at a forced 200-token ceiling: 6 of 6 replies
// came back `length` and 6 of 6 failed to parse. At the shipped ceiling, 12 live
// calls returned 499-770 output tokens and none truncated — so the trigger is a
// tail, and the fix is aimed at the INVARIANT rather than at the trigger:
//
//   1. the ceiling is DERIVED from the content budget, not picked;
//   2. truncation is DETECTED (the client used to discard `finish_reason`);
//   3. there is ONE bounded repair that asks for less with more room;
//   4. and whatever happens, `todaysLesson` still hands back a lesson.
//
// The mock below is the only honest way to test (3) and (4) — a real call cannot be
// made to truncate on demand in CI — and every expectation comes from the mock's
// scripted replies, never from the code under test.
// ─────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-trunc-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const RULE = pickTeachableRule()!;

function goodBody(): string {
  return JSON.stringify({
    intro: "Andare takes essere in the passato prossimo.",
    examples: ["Sono andato al mare."],
    exercises: [
      { prompt: "Ieri ____ andato.", options: ["sono", "ho"], answerIndex: 0, answer: "sono", invite: "click", rationale: "essere." },
      { prompt: "Ieri ____ corso.", options: ["sono", "ho"], answerIndex: 0, answer: "sono", invite: "speak", rationale: "essere." },
    ],
  });
}

/** The exact shape a truncated reply has: half an object, and `finish_reason` says so. */
function truncatedBody(): string {
  return '```json\n{\n  "intro": "Andare takes essere in the passato pross';
}

/** A client that replies from a script and records what it was asked for. */
function scriptedClient(replies: TextCompletion[]) {
  const calls: { maxOutputTokens: number; prompt: string }[] = [];
  const client: TextModelClient = {
    async complete({ prompt, maxOutputTokens }) {
      calls.push({ prompt, maxOutputTokens });
      const next = replies.shift();
      if (!next) throw new Error("the engine made more calls than the script allows");
      return next;
    },
  };
  return { client, calls };
}

const completion = (text: string, finishReason: string): TextCompletion => ({
  text,
  promptTokens: 300,
  completionTokens: 700,
  finishReason,
});

function seedItem(db: Db): string {
  return ensureRuleItem(db, RULE.key, RULE.cefr);
}

function committedSpend(db: Db): number {
  const r = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE state = 'committed'")
    .get() as { total: number };
  return r.total;
}

describe("the token ceiling is derived from the budget, not picked", () => {
  it("is computed from the content caps and clears the measured worst case", () => {
    // Ground truth: the caps themselves. 110 intro words + 5 drills x 60 words,
    // at ~1.4 tokens/word and ~1.5x JSON overhead, doubled.
    const expected = Math.ceil(((MAX_INTRO_WORDS + MAX_DRILLS * MAX_DRILL_WORDS) * 1.4 * 1.5 * 2) / 100) * 100;
    expect(lessonOutputTokenCeiling()).toBe(expected);
    expect(ITEM_LESSON_MAX_OUTPUT_TOKENS).toBe(expected);
    // 770 output tokens was the maximum across 12 live calls on this repo's own
    // prompts. The ceiling must clear it with real headroom, or the tail that
    // caused the defect is still in range.
    expect(lessonOutputTokenCeiling()).toBeGreaterThan(770 * 1.5);
  });

  it("the repair gets MORE room than the attempt that ran out of it", () => {
    expect(lessonRepairTokenCeiling()).toBeGreaterThan(lessonOutputTokenCeiling());
  });
});

describe("truncation is detected rather than parsed into nothing", () => {
  it("wasTruncated reads the provider's own stop reason", () => {
    expect(wasTruncated(completion("{}", "length"))).toBe(true);
    expect(wasTruncated(completion("{}", "stop"))).toBe(false);
    // A mock with no finishReason at all behaves as it always did: not truncated.
    expect(wasTruncated({ text: "{}", promptTokens: 1, completionTokens: 1 })).toBe(false);
  });

  it("repairs a truncated reply with ONE retry, and the retry asks for less", () => {
    const db = freshDb();
    const itemId = seedItem(db);
    const { client, calls } = scriptedClient([
      completion(truncatedBody(), "length"),
      completion(goodBody(), "stop"),
    ]);

    return generateItemLesson(db, client, itemId).then(({ lesson }) => {
      expect(lesson).not.toBeNull();
      expect(lesson!.exercises.every(drillIsUsable)).toBe(true);
      // Exactly two calls: the original and one repair. Never a retry storm.
      expect(calls).toHaveLength(2);
      // The repair asks for brevity AND is given more room — both levers.
      expect(calls[1].prompt).toContain("cut off");
      expect(calls[1].maxOutputTokens).toBeGreaterThan(calls[0].maxOutputTokens);
      // The lesson is cached, so a second open is free.
      expect(getItemLesson(db, itemId)).not.toBeNull();
    });
  });

  it("BILLS BOTH CALLS — a repair is a separate call and understating spend is the worse bug", async () => {
    const db = freshDb();
    const itemId = seedItem(db);
    const { client } = scriptedClient([completion(truncatedBody(), "length"), completion(goodBody(), "stop")]);

    await generateItemLesson(db, client, itemId);

    const rows = db
      .prepare("SELECT content_hash, state FROM spend_ledger ORDER BY content_hash")
      .all() as { content_hash: string; state: string }[];
    // Two committed rows, distinguishable — the truncated call really happened and
    // the ledger says so. Folding them into one charge would model spend below
    // reality, which this repo treats as never-waivable.
    expect(rows.map((r) => r.state)).toEqual(["committed", "committed"]);
    expect(rows.map((r) => r.content_hash)).toEqual([`item-lesson-repair:${itemId}`, `item-lesson:${itemId}`]);
    expect(committedSpend(db)).toBeGreaterThan(0);
  });

  it("a SECOND truncation raises a truthful error and persists NO half-lesson", async () => {
    const db = freshDb();
    const itemId = seedItem(db);
    const { client, calls } = scriptedClient([
      completion(truncatedBody(), "length"),
      completion(truncatedBody(), "length"),
    ]);

    await expect(generateItemLesson(db, client, itemId)).rejects.toBeInstanceOf(TextModelTruncatedError);
    expect(calls).toHaveLength(2); // bounded: one repair, never more
    expect(getItemLesson(db, itemId)).toBeNull();
    // The claim was released, so a legitimate retry can re-lease rather than being
    // locked out by a tombstone.
    const claims = db.prepare("SELECT COUNT(*) AS n FROM item_lessons").get() as { n: number };
    expect(claims.n).toBe(0);
  });
});

describe("the learner gets a lesson whatever the model does", () => {
  it("todaysLesson falls back to the syllabus when generation truncates twice", async () => {
    const db = freshDb();
    const itemId = seedItem(db);
    const { client } = scriptedClient([
      completion(truncatedBody(), "length"),
      completion(truncatedBody(), "length"),
    ]);

    const lesson = await todaysLesson(db, client, itemId);

    // The invariant, stated positively: a lesson EXISTS, it is complete, and it is
    // the deterministic one — no error screen, no "unavailable right now".
    expect(lesson).not.toBeNull();
    expect(lesson!.deterministic).toBe(true);
    expect(lesson!.exercises.length).toBeGreaterThanOrEqual(2);
    expect(lesson!.exercises.every(drillIsUsable)).toBe(true);
  });

  it("falls back when the reply is unreadable, and when the call fails outright", async () => {
    for (const script of [
      [completion("not json at all", "stop")],
      [] as TextCompletion[], // the client throws — a network failure
    ]) {
      const db = freshDb();
      const itemId = seedItem(db);
      const { client } = scriptedClient(script);
      const lesson = await todaysLesson(db, client, itemId);
      expect(lesson).not.toBeNull();
      expect(lesson!.deterministic).toBe(true);
    }
  });

  it("prefers the GENERATED lesson when there is one — the fallback is a floor, not a ceiling", async () => {
    const db = freshDb();
    const itemId = seedItem(db);
    const { client } = scriptedClient([completion(goodBody(), "stop")]);

    const lesson = await todaysLesson(db, client, itemId);
    expect(lesson!.deterministic).toBeUndefined();
    expect(lesson!.intro).toBe("Andare takes essere in the passato prossimo.");
  });
});
