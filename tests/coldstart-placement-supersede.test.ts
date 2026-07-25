import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { BANDS, scorePlacement, MAX_FALSE_ALARM_RATE, type Band, type PlacementAnswer } from "@/lib/placement/scoring";
import type { Db } from "@/lib/db";

// RETRO-004 §DE-2, the cold-start gate's second critical. The reviewer's sequence,
// reproduced end to end:
//
//   1. Drive the check with a plausible-careless pattern (~75% "I know it", applied
//      without discriminating real words from invented ones). It returned
//      "Placed around C2." with NO caveat — while the same result had the learner
//      FAILING A1 (0.43) and A2 (0.14) — and seeded 238 grammar rules as `introduced`.
//   2. Re-take the check honestly as an A1 beginner. It returned `level: "A1"` and
//      `/api/learn/items` STILL served the same C2 grammar. Only deleting the database
//      recovered.
//
// So there are two things to prove: the scorer no longer produces a confident nonsense
// level, and a re-placement actually re-places. The second is driven through the REAL
// POST /api/placement route and the REAL plan read model — the surfaces the reviewer
// used — because the defect lived in the seam between them.

let root: string;
let db: Db;
let PLACEMENT_POST: typeof import("@/app/api/placement/route").POST;
let buildLearnItems: typeof import("@/lib/learn-items").buildLearnItems;
let currentPlacementRun: typeof import("@/lib/knowledge/placement-runs").currentPlacementRun;

beforeAll(async () => {
  root = tmpDir("erika-placement-supersede-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  PLACEMENT_POST = (await import("@/app/api/placement/route")).POST;
  buildLearnItems = (await import("@/lib/learn-items")).buildLearnItems;
  currentPlacementRun = (await import("@/lib/knowledge/placement-runs")).currentPlacementRun;
  db = (await import("@/lib/db")).getDb();
});

const PER_BAND = 8;
const PSEUDO = 16;

/** Real answers for a band: the first `yes` of `PER_BAND` marked known. */
function band(b: Band, yes: number, ids: string[]): PlacementAnswer[] {
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

/** Real lemma ids that EXIST in the seeded inventory, so seeding is not silently
 *  skipped — the reviewer's run seeded 38 real words. */
function lemmaIds(count: number): string[] {
  return (
    db
      .prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT ?")
      .all(count) as { id: string }[]
  ).map((r) => r.id);
}

async function place(answers: PlacementAnswer[]) {
  const res = await PLACEMENT_POST(
    new Request("http://t/api/placement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as {
    level: Band | null;
    calibrated: boolean;
    caveat: string | null;
    highestCleared: Band | null;
    contiguous: boolean;
    falseAlarmRate: number;
    runId: string;
    seededWords: number;
    seededRules: number;
    supersededItems: number;
  };
}

/** The CEFR bands of the grammar rules today's plan is actually serving. */
function planRuleBands(): string[] {
  return buildLearnItems(db)
    .items.filter((i) => i.kind === "grammar")
    .map((i) => i.detail);
}

describe("the careless pattern no longer yields a confident high level (§DE-2 layer 1)", () => {
  it("the reviewer's exact answers place NOBODY at C2, and say why", () => {
    // The measured replay: policy 3of4, 64 items, 16 pseudo, 9 pseudo-yes → fa 0.5625,
    // and per-band corrected 0.43 / 0.14 / 0.71 / 0.71 / 0.43 / 1.00.
    const ids = Array.from({ length: PER_BAND }, (_, i) => `lemma:w${i}#NOUN`);
    const answers = [
      ...band("A1", 6, ids),
      ...band("A2", 5, ids),
      ...band("B1", 7, ids),
      ...band("B2", 7, ids),
      ...band("C1", 6, ids),
      ...band("C2", 8, ids),
      ...pseudos(9),
    ];
    const r = scorePlacement(answers);

    // The inputs really are the reviewer's.
    expect(r.falseAlarmRate).toBeCloseTo(0.5625, 4);
    expect(r.bands.find((b) => b.band === "A1")!.corrected).toBeCloseTo(0.4286, 3);
    expect(r.bands.find((b) => b.band === "A2")!.corrected).toBeCloseTo(0.1429, 3);
    expect(r.bands.find((b) => b.band === "C2")!.corrected).toBeCloseTo(1, 5);

    // C2 alone still clears — and is still refused, because A1 and A2 do not.
    expect(r.highestCleared).toBe("C2");
    expect(r.level).not.toBe("C2");
    expect(r.level).toBeNull(); // A1 fails, so the contiguous run is empty
    expect(r.contiguous).toBe(false);

    // And it is NOT presented as confident. This is the assertion that failed before:
    // `calibrated` checked sample sizes only, both of which passed.
    expect(r.calibrated).toBe(false);
    expect(r.caveat).toBe("response-style");
  });

  it("a coherent advanced learner is still placed, and confidently", () => {
    const ids = Array.from({ length: PER_BAND }, (_, i) => `lemma:w${i}#NOUN`);
    const r = scorePlacement([
      ...BANDS.slice(0, 5).flatMap((b) => band(b, 8, ids)), // A1…C1 all known
      ...band("C2", 1, ids), // C2 not
      ...pseudos(0), // and the non-words correctly rejected
    ]);
    expect(r.level).toBe("C1");
    expect(r.contiguous).toBe(true);
    expect(r.caveat).toBeNull();
    expect(r.calibrated).toBe(true);
  });

  it("a false-alarm rate past the threshold can never read as calibrated", () => {
    const ids = Array.from({ length: PER_BAND }, (_, i) => `lemma:w${i}#NOUN`);
    const yesFa = Math.floor(PSEUDO * MAX_FALSE_ALARM_RATE) + 1;
    const r = scorePlacement([...BANDS.flatMap((b) => band(b, 8, ids)), ...pseudos(yesFa)]);
    expect(r.falseAlarmRate).toBeGreaterThan(MAX_FALSE_ALARM_RATE);
    expect(r.calibrated).toBe(false);
    expect(r.caveat).toBe("response-style");
  });
});

describe("re-placement supersedes — place C2, then re-place A1 (§DE-2 layer 2)", () => {
  it("the daily plan follows the newest placement, and the old level's grammar leaves it", async () => {
    const ids = lemmaIds(PER_BAND * BANDS.length);
    const idsFor = (i: number) => ids.slice(i * PER_BAND, (i + 1) * PER_BAND);

    // ── 1. A confident C2 placement (contiguous, non-words rejected). This is the
    //       state the reviewer was stuck in: hundreds of rules seeded `introduced`.
    const c2 = await place([
      ...BANDS.map((b, i) => band(b, 8, idsFor(i))).flat(),
      ...pseudos(0),
    ]);
    expect(c2.level).toBe("C2");
    expect(c2.calibrated).toBe(true);
    expect(c2.seededRules).toBeGreaterThan(100); // the reviewer measured 238
    expect(c2.supersededItems).toBe(0); // nothing to supersede on a first run

    // The plan really does serve advanced grammar now.
    const bandsAfterC2 = planRuleBands();
    expect(bandsAfterC2.length).toBeGreaterThan(0);
    const advanced = bandsAfterC2.filter((b) => b === "C1" || b === "C2");
    expect(advanced.length).toBeGreaterThan(0);

    // ── 2. Re-take it honestly as an A1 beginner — the exact remedy Settings offers.
    const a1 = await place([
      ...band("A1", 8, idsFor(0)),
      ...BANDS.slice(1).map((b, i) => band(b, 0, idsFor(i + 1))).flat(),
      ...pseudos(0),
    ]);
    expect(a1.level).toBe("A1");
    expect(a1.calibrated).toBe(true);
    expect(a1.runId).not.toBe(c2.runId);
    // The retraction actually happened: the C2 run's items were re-derived.
    expect(a1.supersededItems).toBeGreaterThan(100);

    // ── 3. THE ASSERTION THAT FAILED BEFORE. The plan no longer serves the old
    //       level's grammar. (Previously: `level: "A1"` and the same three C2 rules.)
    const bandsAfterA1 = planRuleBands();
    expect(bandsAfterA1.length).toBeGreaterThan(0); // still a plan — not an empty day
    expect(bandsAfterA1.filter((b) => b === "C2")).toEqual([]);
    expect(bandsAfterA1.filter((b) => b === "C1")).toEqual([]);
    expect(bandsAfterA1.filter((b) => b === "B2")).toEqual([]);

    // The superseded rules are back to `unseen` — the cache was genuinely re-derived,
    // not merely hidden from one read.
    const stillIntroduced = db
      .prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='rule' AND cefr IN ('B2','C1','C2') AND status <> 'unseen'")
      .get() as { n: number };
    expect(stillIntroduced.n).toBe(0);

    // ── 4. Append-only held throughout. Nothing was updated or deleted: BOTH runs'
    //       rows are still in the log (the v14 triggers would have aborted otherwise).
    const stored = db
      .prepare("SELECT source_ref, COUNT(*) AS n FROM evidence WHERE source='placement' GROUP BY source_ref")
      .all() as { source_ref: string; n: number }[];
    expect(stored.map((r) => r.source_ref).sort()).toEqual(
      [`placement:${c2.runId}`, `placement:${a1.runId}`].sort(),
    );
    expect(stored.find((r) => r.source_ref === `placement:${c2.runId}`)!.n).toBeGreaterThan(100);
    expect(currentPlacementRun(db)!.id).toBe(a1.runId);

    // ── 5. And the D-19 invariant is untouched: recognition never mints `known`.
    const known = db
      .prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE status = 'known'")
      .get() as { n: number };
    expect(known.n).toBe(0);
  });

  it("the append-only triggers are still armed — supersession did not relax them", () => {
    const row = db.prepare("SELECT id FROM evidence LIMIT 1").get() as { id: string } | undefined;
    expect(row).toBeDefined();
    expect(() => db.prepare("DELETE FROM evidence WHERE id = ?").run(row!.id)).toThrow(/append-only/);
    expect(() => db.prepare("UPDATE evidence SET polarity = 0 WHERE id = ?").run(row!.id)).toThrow(
      /append-only/,
    );
  });
});
