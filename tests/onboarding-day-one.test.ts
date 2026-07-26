import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { BANDS, bandIndex, type Band, type PlacementAnswer } from "@/lib/placement/scoring";
import type { Db } from "@/lib/db";

// E-46 Amendment 1 — DAY ONE MUST BE CALIBRATED, NOT GENERIC.
//
// E-44 answered its own criterion 11 honestly and the answer is the reason this file
// exists: a learner on day one with no placement and no recordings gets a generic
// session — rule #1 at A1. The machinery to do better already existed (E-35 places,
// E-31 composes at the edge); the only reason day one was generic is that placement
// was SKIPPABLE, which criterion 1 of this milestone removes. So what is left to
// prove is that the level the assessment produces actually reaches the first session.
//
// THE ASSERTION IS POSITIVE, DELIBERATELY. "The first session has no A1 rule" is
// satisfied by a session with no lesson at all, and this repo has shipped exactly
// that shape of vacuous assertion before (RETRO-004 §3: four vacuous tests in one
// version, including an absence-only grep). So every case below asserts that a
// lesson EXISTS and that its CEFR band is the one the learner was placed at.
//
// It is driven through the REAL surfaces — `POST /api/placement` and E-44's
// `planSession` — because the defect Amendment 1 names lives in the seam between
// them, not inside either.

let root: string;
let db: Db;
let PLACEMENT_POST: typeof import("@/app/api/placement/route").POST;
let planSession: typeof import("@/lib/session/plan").planSession;
let loadSyllabus: typeof import("@/lib/syllabus").loadSyllabus;

beforeAll(async () => {
  root = tmpDir("erika-day-one-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  PLACEMENT_POST = (await import("@/app/api/placement/route")).POST;
  planSession = (await import("@/lib/session/plan")).planSession;
  loadSyllabus = (await import("@/lib/syllabus")).loadSyllabus;
  db = (await import("@/lib/db")).getDb();
});

const PER_BAND = 8;
const PSEUDO = 16;

function bandAnswers(b: Band, yes: number, ids: string[]): PlacementAnswer[] {
  return Array.from({ length: PER_BAND }, (_, i) => ({
    kind: "real" as const,
    band: b,
    itemId: ids[i],
    known: i < yes,
  }));
}
function pseudos(yes: number): PlacementAnswer[] {
  return Array.from({ length: PSEUDO }, (_, i) => ({ kind: "pseudo" as const, known: i < yes }));
}
function lemmaIds(count: number): string[] {
  return (
    db.prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT ?").all(count) as {
      id: string;
    }[]
  ).map((r) => r.id);
}

/** An honest learner who clears every band up to and including `top`. */
function honestThrough(top: Band): PlacementAnswer[] {
  const ids = lemmaIds(PER_BAND * BANDS.length);
  const answers: PlacementAnswer[] = [];
  BANDS.forEach((b, i) => {
    const slice = ids.slice(i * PER_BAND, (i + 1) * PER_BAND);
    answers.push(...bandAnswers(b, bandIndex(b) <= bandIndex(top) ? PER_BAND : 0, slice));
  });
  answers.push(...pseudos(0)); // every invented word correctly rejected
  return answers;
}

interface PlacementResponse {
  level: Band | null;
  levelSource: "check" | "spoken" | "none";
  calibrated: boolean;
  caveat: string | null;
  seededWords: number;
  seededRules: number;
  runId: string | null;
}

async function place(body: Record<string, unknown>): Promise<PlacementResponse> {
  const res = await PLACEMENT_POST(
    new Request("http://t/api/placement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as PlacementResponse;
}

/** The CEFR band of the rule today's session teaches, or null when it teaches a lemma
 *  or nothing at all. Read from the syllabus, not from the plan's own label. */
function lessonRuleBand(database: Db, day: string): { itemId: string | null; cefr: string | null } {
  const plan = planSession(database, day);
  const id = plan.lessonItemId;
  if (!id || !id.startsWith("rule:")) return { itemId: id, cefr: null };
  const key = id.slice("rule:".length);
  return { itemId: id, cefr: loadSyllabus().rules.find((r) => r.key === key)?.cefr ?? null };
}

describe("day one is composed from the placement result", () => {
  it("a B1-placed learner's first session teaches a B1 rule, not the A1 opener", async () => {
    const placed = await place({ answers: honestThrough("B1") });
    expect(placed.level).toBe("B1");
    expect(placed.runId).not.toBeNull();
    expect(placed.seededRules).toBeGreaterThan(0);

    const { itemId, cefr } = lessonRuleBand(db, "2026-07-26");
    // THE POSITIVE. A lesson exists…
    expect(itemId).not.toBeNull();
    expect(itemId).toMatch(/^rule:/);
    // …and it is at the placed level, which is the whole claim.
    expect(cefr).toBe("B1");
  });

  it("and re-placing the same learner at B2 moves the lesson to B2 — the level drives it", async () => {
    // Re-taking supersedes (v27), which is the mechanism that makes a placement
    // repairable. Driving it here proves the second half of the claim: the lesson is
    // not merely "not A1", it TRACKS the placed level.
    const placed = await place({ answers: honestThrough("B2") });
    expect(placed.level).toBe("B2");

    const { itemId, cefr } = lessonRuleBand(db, "2026-07-27");
    expect(itemId).toMatch(/^rule:/);
    expect(cefr).toBe("B2");
  });
});

describe("a learner who will not, or cannot, speak is still calibrated (criterion 11)", () => {
  it("places and composes from the word check alone when no spoken band arrives", async () => {
    // No microphone, a denied permission, no API key, or simple reluctance: they all
    // arrive here, as `spokenBand: null`. The level must still be real and the first
    // session must still be at it.
    const placed = await place({ answers: honestThrough("B1"), spokenBand: null });
    expect(placed.level).toBe("B1");
    expect(placed.levelSource).toBe("check");

    const { itemId, cefr } = lessonRuleBand(db, "2026-07-28");
    expect(itemId).toMatch(/^rule:/);
    expect(cefr).toBe("B1");
  });
});
