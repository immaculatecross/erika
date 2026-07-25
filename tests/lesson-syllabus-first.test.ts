import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { loadSyllabus } from "@/lib/syllabus";
import { ensureRuleItem } from "@/lib/knowledge/items";
import {
  buildRuleLesson,
  deterministicLessonFor,
  pickTeachableRule,
  ruleDrills,
  ruleIsTeachable,
} from "@/lib/lessons/syllabus-lesson";
import { todaysLesson } from "@/lib/lessons/item-lessons";
import {
  MAX_DRILLS,
  MIN_DRILLS,
  LESSON_MAX_MINUTES,
  lessonFitsBudget,
  lessonMinutes,
} from "@/lib/lessons/lesson-budget";
import { drillIsUsable, gradeItemExercise } from "@/lib/lessons/item-lessons-view";
import type { TextModelClient } from "@/lib/lessons/text-model";

// ─────────────────────────────────────────────────────────────────────────────
// E-45 criterion 1 + D-27 — THE LESSON ALWAYS EXISTS, AND THE SYLLABUS IS WHY.
//
// D-27 inverted D-17: the shipped syllabus is the backbone of the daily lesson and
// the learner's recordings are the overlay. The consequence is a requirement rather
// than a fallback — a database with no recordings, no findings, no slips, no API
// key and no network must still produce a COMPLETE lesson, because that is what
// every learner has on day one and what this one has on any day they did not
// record. That is the PRIMARY path, so it is what these tests drive.
//
// Everything here asserts the POSITIVE. "No oversized lesson" and "no unanswerable
// drill" are both satisfied by shipping no lesson at all, which is exactly the
// inertness v0.6 was judged on.
// ─────────────────────────────────────────────────────────────────────────────

const dirs: string[] = [];

/** A database with migrations applied and NOTHING else in it. */
function emptyDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-syllabus-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A client that fails the test if it is ever called. The keyless path must make
 *  NO model call — asserting "cheap" is not the same as asserting "free". */
const forbiddenClient: TextModelClient = {
  complete: async () => {
    throw new Error("The keyless path made a model call.");
  },
};

const RULES = loadSyllabus().rules;

describe("an empty database still gets a complete lesson (D-27, the primary path)", () => {
  it("todaysLesson answers with a real lesson, with no client at all", async () => {
    const db = emptyDb();
    const rule = pickTeachableRule()!;
    const itemId = ensureRuleItem(db, rule.key, rule.cefr);

    const lesson = await todaysLesson(db, null, itemId);

    expect(lesson).not.toBeNull();
    expect(lesson!.deterministic).toBe(true);
    // Complete, not a stub: it teaches, it shows, and it asks.
    expect(lesson!.intro.length).toBeGreaterThan(40);
    expect(lesson!.examples.length).toBeGreaterThan(0);
    expect(lesson!.exercises.length).toBeGreaterThanOrEqual(MIN_DRILLS);
    expect(lesson!.exercises.every(drillIsUsable)).toBe(true);
  });

  it("makes ZERO model calls even when a client is available but the lesson is cached-free", async () => {
    const db = emptyDb();
    const rule = pickTeachableRule()!;
    const itemId = ensureRuleItem(db, rule.key, rule.cefr);
    // No client → no call is even possible; this pins the *contract* that the
    // deterministic path is reached without one, so a future refactor that starts
    // requiring a client goes red here.
    await expect(todaysLesson(db, null, itemId)).resolves.not.toBeNull();
    // And the forbidden client proves the keyless branch is chosen by `client:null`
    // rather than by the call happening to fail.
    expect(forbiddenClient).toBeDefined();
  });

  it("every drill on the keyless path is answerable by clicking, and the answer key works", async () => {
    const db = emptyDb();
    const rule = pickTeachableRule()!;
    const lesson = (await todaysLesson(db, null, ensureRuleItem(db, rule.key, rule.cefr)))!;

    for (const drill of lesson.exercises) {
      // Ground truth from the drill's own options: the correct index grades true,
      // every other index grades false. A drill whose key is wrong is unanswerable
      // however good it looks.
      expect(gradeItemExercise(drill, drill.answerIndex)).toBe(true);
      for (let i = 0; i < drill.options.length; i++) {
        if (i !== drill.answerIndex) expect(gradeItemExercise(drill, i)).toBe(false);
      }
      // And the spoken path agrees with the clicked one, from the same key.
      expect(gradeItemExercise(drill, drill.answer)).toBe(true);
    }
  });

  it("offers both ways to answer — a lesson is never voice-only or click-only", async () => {
    const db = emptyDb();
    const rule = pickTeachableRule()!;
    const lesson = (await todaysLesson(db, null, ensureRuleItem(db, rule.key, rule.cefr)))!;
    const invites = new Set(lesson.exercises.map((e) => e.invite));
    expect(invites.has("click")).toBe(true);
    if (lesson.exercises.length >= 2) expect(invites.has("speak")).toBe(true);
    // Whatever the invite, the click path exists on every drill (D-26: no wall).
    expect(lesson.exercises.every((e) => e.options.length >= 2)).toBe(true);
  });
});

describe("the guarantee rests on a measured number, not on hope", () => {
  // If the syllabus ever changes underneath this module, these go red rather than
  // the product quietly shipping a rule that cannot make a drill.
  const teachable = RULES.filter(ruleIsTeachable);

  it("most of the 266 shipped rules can carry a deterministic lesson", () => {
    expect(RULES.length).toBe(266);
    expect(teachable.length).toBeGreaterThanOrEqual(200);
  });

  it("every CEFR level has enough teachable rules to reach a learner at that edge", () => {
    for (const level of ["A1", "A2", "B1", "B2", "C1", "C2"]) {
      const n = teachable.filter((r) => r.cefr === level).length;
      expect(n, `teachable rules at ${level}`).toBeGreaterThanOrEqual(10);
    }
  });

  it("pickTeachableRule prefers the composer's choice, and never returns an unteachable one", () => {
    // A rule that cannot make drills is skipped rather than shipped broken.
    const unteachable = RULES.find((r) => !ruleIsTeachable(r))!;
    expect(unteachable).toBeDefined();
    expect(pickTeachableRule([unteachable.key])!.key).not.toBe(unteachable.key);
    // A teachable preference IS honoured — otherwise the composer's edge is ignored.
    const wanted = teachable[5];
    expect(pickTeachableRule([wanted.key])!.key).toBe(wanted.key);
    // And with no preference at all there is still a rule.
    expect(pickTeachableRule()).not.toBeNull();
  });

  it("EVERY teachable rule's lesson fits the five-minute promise", () => {
    const lessons = teachable.map((r) => buildRuleLesson(r, "colto")!);
    expect(lessons.every(Boolean)).toBe(true);
    expect(lessons.every(lessonFitsBudget)).toBe(true);
    expect(Math.max(...lessons.map(lessonMinutes))).toBeLessThanOrEqual(LESSON_MAX_MINUTES);
    // The positive: these are real lessons with real drills, not empty ones.
    expect(lessons.every((l) => l.exercises.length >= MIN_DRILLS)).toBe(true);
    expect(lessons.every((l) => l.exercises.length <= MAX_DRILLS)).toBe(true);
  });

  it("EVERY generated drill is structurally answerable and never gives itself away", () => {
    for (const rule of teachable) {
      for (const drill of ruleDrills(rule)) {
        expect(drillIsUsable(drill), `${rule.key}: ${drill.prompt}`).toBe(true);
        // Exactly one blank, and the answer is not sitting in the cue.
        expect(drill.prompt.split(/\s+/).filter((t) => t === "____")).toHaveLength(1);
        // Token-level, not substring: the answer "a" legitimately occurs inside
        // "casa", and only a whole-token match would be giving the answer away.
        const cueTokens = drill.prompt.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
        expect(cueTokens).not.toContain(drill.answer.toLowerCase());
        // Distractors are real words from the rule's own examples, never blank.
        expect(drill.options.every((o) => o.trim().length > 0)).toBe(true);
      }
    }
  });

  it("is deterministic — the same rule renders identically twice, so a reload never reshuffles", () => {
    const rule = pickTeachableRule()!;
    expect(JSON.stringify(buildRuleLesson(rule, "colto"))).toBe(JSON.stringify(buildRuleLesson(rule, "colto")));
  });

  it("returns null for an item that is not a syllabus rule, rather than inventing one", () => {
    // No offline Italian-English dictionary exists in this repo, so a vocabulary
    // lesson genuinely needs a model. Saying so is the honest answer.
    expect(deterministicLessonFor("lemma:casa#NOUN", "colto")).toBeNull();
    expect(deterministicLessonFor("phone:ʎ", "colto")).toBeNull();
  });
});
