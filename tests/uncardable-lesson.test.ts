import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import {
  persistSegmentFindings,
  UNCARDABLE_CATEGORIES,
  isCardable,
  type Category,
  type Finding,
} from "@/lib/analysis/findings";
import { listIncludedFindings } from "@/lib/findings-model";
import { derivePatterns, PATTERN_THRESHOLD, patternKey } from "@/lib/lessons/patterns";
import { generateLessonForPattern } from "@/lib/lessons/generate";
import { UNCARDABLE_CATEGORIES as CARDS_REEXPORT } from "@/lib/cards";
import type { TextModelClient } from "@/lib/lessons/text-model";

// E-39 §B7 — a pronunciation pattern must never bill a typed text lesson.
//
// This is the RETRO-003 defect `UNCARDABLE_CATEGORIES` was introduced to prevent, one door
// further along. A mispronunciation's spelling was never wrong, so a typed cloze has no
// localized change to hide and degrades to an unanswerable "____ · pronunciation". Card
// generation refused it correctly — but the rule was PRIVATE to lib/cards.ts, so
// `derivePatterns` still emitted a `pronunciation` pattern, /practice/lessons offered it,
// and POST /api/lessons/generate handed it to `generateLessonForPattern`: a BILLED
// text-model call producing exactly that exercise, on the learner's money.
//
// The decisive assertion is the money one: with a spy client, a pronunciation pattern must
// produce ZERO model calls and ZERO ledger rows. The expectations come from the fixture —
// the seed says how many findings of which category exist.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-uncardable-lesson-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

let seq = 0;
function finding(category: Category): Finding {
  seq += 1;
  return {
    id: `f${seq}`,
    sessionId: "s1",
    contentHash: "h",
    quote: `q${seq}`,
    correction: `c${seq}`,
    category,
    explanation: "e",
    severity: "low",
    startMs: 0,
    endMs: 0,
  };
}
const nOf = (category: Category, n: number): Finding[] =>
  Array.from({ length: n }, () => finding(category));

/** A client that records every call. It must never be reached for an uncardable pattern. */
function spyClient(): TextModelClient & { calls: number } {
  const spy = {
    calls: 0,
    async complete() {
      spy.calls += 1;
      throw new Error("the text model must not be called for an uncardable pattern");
    },
  };
  return spy as TextModelClient & { calls: number };
}

/** Seed `n` findings of `category` as an analysed run leaves them, so the real read path
 *  (`listIncludedFindings`, the E-17 gate) returns them. */
function seedAnalysed(db: Db, category: Category, n: number): void {
  createSession(db, {
    id: "s1",
    originalFilename: "s.wav",
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 60,
  });
  db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES ('j1', 's1', 'done')").run();
  upsertSegment(db, { sessionId: "s1", idx: 0, startMs: 0, endMs: 1000, contentHash: "h1" });
  persistSegmentFindings(db, {
    sessionId: "s1",
    contentHash: "h1",
    flagged: true,
    deepDone: true,
    findings: Array.from({ length: n }, (_, i) => ({
      quote: `q${i}`,
      correction: `c${i}`,
      category,
      explanation: "e",
      severity: "low" as const,
      startMs: i * 10,
      endMs: i * 10 + 5,
    })),
  });
}

describe("the uncardable rule has ONE definition (E-39 §B7)", () => {
  it("lib/cards.ts re-exports the same object, so there is no second source of truth", () => {
    expect(CARDS_REEXPORT).toBe(UNCARDABLE_CATEGORIES);
    expect([...UNCARDABLE_CATEGORIES]).toEqual(["pronunciation"]);
    expect(isCardable("pronunciation")).toBe(false);
    expect(isCardable("grammar")).toBe(true);
  });
});

describe("derivePatterns refuses a category no typed lesson can teach", () => {
  it("emits NO pattern for pronunciation, however many findings there are", () => {
    // The fixture: five pronunciation findings, well past the threshold of three.
    const pron = nOf("pronunciation", PATTERN_THRESHOLD + 2);
    expect(pron).toHaveLength(5);
    expect(derivePatterns(pron)).toEqual([]);
  });

  it("still emits every pattern a lesson CAN teach — the over-exclusion mirror", () => {
    // Four teachable categories at the threshold, plus pronunciation past it. Only the
    // pronunciation one may be missing; dropping a teachable pattern is as wrong.
    const teachable: Category[] = ["grammar", "vocabulary", "phrasing", "idiom"];
    const findings = [
      ...teachable.flatMap((c) => nOf(c, PATTERN_THRESHOLD)),
      ...nOf("pronunciation", PATTERN_THRESHOLD + 2),
    ];
    const keys = derivePatterns(findings).map((p) => p.key);
    expect(keys).toEqual(teachable.map(patternKey));
    expect(keys).not.toContain(patternKey("pronunciation"));
    // And each teachable one still carries its own findings, unchanged.
    for (const p of derivePatterns(findings)) expect(p.count).toBe(PATTERN_THRESHOLD);
  });
});

describe("no pronunciation pattern can reach a BILLED text-model call", () => {
  it("the pattern is not derivable from a real analysed run, so nothing is generated", async () => {
    const db = freshDb();
    seedAnalysed(db, "pronunciation", PATTERN_THRESHOLD + 2);
    // Prove the premise: the findings really are there and really are in scope, else this
    // test would pass for the wrong reason.
    expect(listIncludedFindings(db)).toHaveLength(PATTERN_THRESHOLD + 2);

    const patterns = derivePatterns(listIncludedFindings(db));
    expect(patterns).toEqual([]);

    // The route's own lookup — `derivePatterns(...).find(p => p.key === patternKey)` — can
    // therefore never hand this to the generator: it 404s before any money is reserved.
    expect(patterns.find((p) => p.key === patternKey("pronunciation"))).toBeUndefined();

    const spy = spyClient();
    const ledgerBefore = (db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n;
    for (const p of patterns) await generateLessonForPattern(db, spy, p);
    expect(spy.calls).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(
      ledgerBefore,
    );
    expect((db.prepare("SELECT COUNT(*) AS n FROM lessons").get() as { n: number }).n).toBe(0);
    db.close();
  });

  it("a teachable pattern from the same path DOES reach the generator", async () => {
    // The positive half: the refusal above must be about the category, not about the seed
    // being unreachable. Same seeding, same read path, one call.
    const db = freshDb();
    seedAnalysed(db, "grammar", PATTERN_THRESHOLD);
    const patterns = derivePatterns(listIncludedFindings(db));
    expect(patterns.map((p) => p.key)).toEqual([patternKey("grammar")]);

    const spy = spyClient();
    await expect(generateLessonForPattern(db, spy, patterns[0])).rejects.toThrow();
    expect(spy.calls).toBe(1);
    db.close();
  });
});
