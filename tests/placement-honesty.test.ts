import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { BANDS, scorePlacement, MAX_FALSE_ALARM_RATE, type Band, type PlacementAnswer } from "@/lib/placement/scoring";
import type { Db } from "@/lib/db";

// REVIEW-63 F1/N1/N2 — the placement seam telling the learner something that is not what
// it did. Same class of defect as RETRO-004 §DE-2, one layer further in: after that fix the
// screen said the right thing while the writes said another.
//
//   F1  A run the screen calls unmeasurable ("Nothing has been assumed about your level —
//       your daily plan is unchanged") still wrote 39 recognition rows; across 15 check
//       seeds 1 in 15 measurably changed the next day's vocabulary list. Second face: a
//       3-of-4 careless run (fa 0.625) was PLACED at A2 and seeded 65 rules + 38 words.
//   N1  A crafted 16-answer POST (8 C2 words known, 8 non-words rejected) returned
//       `level: "C2", calibrated: true, caveat: null` and seeded 238 rules — with zero
//       evidence about A1–C1.
//   N2  `fa` exactly at MAX_FALSE_ALARM_RATE read as calibrated, though the constant's own
//       docstring calls that value "already careless".
//
// So every assertion here pairs the RETURNED result with the DATABASE, through the real
// POST /api/placement and the real plan read model. A claim the writes do not back is the
// defect, and only the DB can catch it.

let root: string;
let db: Db;
let PLACEMENT_POST: typeof import("@/app/api/placement/route").POST;
let buildLearnItems: typeof import("@/lib/learn-items").buildLearnItems;
let currentPlacementRun: typeof import("@/lib/knowledge/placement-runs").currentPlacementRun;
let placementStatus: typeof import("@/lib/placement/status").placementStatus;

beforeAll(async () => {
  root = tmpDir("erika-placement-honesty-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  PLACEMENT_POST = (await import("@/app/api/placement/route")).POST;
  buildLearnItems = (await import("@/lib/learn-items")).buildLearnItems;
  currentPlacementRun = (await import("@/lib/knowledge/placement-runs")).currentPlacementRun;
  placementStatus = (await import("@/lib/placement/status")).placementStatus;
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
function pseudos(yes: number, n = PSEUDO): PlacementAnswer[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "pseudo" as const, known: i < yes }));
}

/** Real lemma ids that EXIST in the inventory, so seeding is not silently skipped —
 *  without these a "wrote nothing" assertion would pass for the wrong reason. */
function lemmaIds(count: number): string[] {
  return (
    db
      .prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT ?")
      .all(count) as { id: string }[]
  ).map((r) => r.id);
}

interface PlaceResponse {
  level: Band | null;
  calibrated: boolean;
  caveat: string | null;
  highestCleared: Band | null;
  contiguous: boolean;
  falseAlarmRate: number;
  runId: string | null;
  seededWords: number;
  seededRules: number;
  supersededItems: number;
}

async function place(answers: PlacementAnswer[]): Promise<PlaceResponse> {
  const res = await PLACEMENT_POST(
    new Request("http://t/api/placement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as PlaceResponse;
}

/** What placement has actually written — the only witness that matters here. */
function writes() {
  const rows = db
    .prepare("SELECT COUNT(*) AS n FROM evidence WHERE source = 'placement'")
    .get() as { n: number };
  const runs = db.prepare("SELECT COUNT(*) AS n FROM placement_runs").get() as { n: number };
  return { evidenceRows: rows.n, runs: runs.n };
}
/** Everything today's plan is serving, vocab and grammar — the surface the learner sees,
 *  so a plan that "changed" changes this list. */
function planRefs(): string[] {
  return buildLearnItems(db).items.map((i) => `${i.kind}:${i.detail}:${i.itemId}`);
}

// ─────────────────────────────────────────────────────────────────────────────────────
// F1 — the copy and the writes must agree.
// ─────────────────────────────────────────────────────────────────────────────────────

describe("F1 · an unmeasurable run writes NOTHING, which is what the screen says", () => {
  it("the retro's careless profile (fa 0.5625) leaves the database untouched", async () => {
    const ids = lemmaIds(PER_BAND);
    expect(ids).toHaveLength(PER_BAND); // the words really do exist, so seeding COULD happen
    const planBefore = planRefs();
    expect(planBefore.length).toBeGreaterThan(0);

    const r = await place([
      ...band("A1", 6, ids),
      ...band("A2", 5, ids),
      ...band("B1", 7, ids),
      ...band("B2", 7, ids),
      ...band("C1", 6, ids),
      ...band("C2", 8, ids),
      ...pseudos(9),
    ]);

    // The inputs are the reviewer's, and the verdict is unchanged from PR #63.
    expect(r.falseAlarmRate).toBeCloseTo(0.5625, 4);
    expect(r.level).toBeNull();
    expect(r.caveat).toBe("response-style");
    expect(r.calibrated).toBe(false);

    // THE ASSERTION THAT FAILED BEFORE. Measured then: seededWords 39.
    expect(r.seededWords).toBe(0);
    expect(r.seededRules).toBe(0);
    expect(r.runId).toBeNull();

    // And the database agrees with the sentence, not merely with the counters: no
    // evidence, and no run row either — a run would have superseded any earlier
    // placement, which is the other way to make "your plan is unchanged" false.
    expect(writes()).toEqual({ evidenceRows: 0, runs: 0 });
    expect(currentPlacementRun(db)).toBeNull();
    expect(placementStatus(db).placed).toBe(false); // nothing was assumed, so nobody is placed
    expect(planRefs()).toEqual(planBefore); // "your daily plan is unchanged", literally
  });

  it("the second face: the run that used to be PLACED at A2 with 65 rules", async () => {
    const ids = lemmaIds(PER_BAND);
    // 3-of-4 careless in presentation order → fa 0.625, and A1/A2 clear even after the
    // correction, so the band walk really does reach A2. Measured before the fix:
    // level "A2", caveat "response-style", seededRules 65, seededWords 38.
    const r = await place([
      ...band("A1", 7, ids),
      ...band("A2", 7, ids),
      ...band("B1", 6, ids),
      ...band("B2", 6, ids),
      ...band("C1", 6, ids),
      ...band("C2", 6, ids),
      ...pseudos(10),
    ]);
    expect(r.falseAlarmRate).toBeCloseTo(0.625, 4);

    // The bands DID clear a contiguous run to A2 — this is what makes the assertion
    // below load-bearing rather than incidental. The level is refused anyway.
    expect(r.highestCleared).toBe("A2");
    expect(r.contiguous).toBe(true);
    expect(r.level).toBeNull();
    expect(r.caveat).toBe("response-style");

    expect(r.seededRules).toBe(0); // was 65
    expect(r.seededWords).toBe(0); // was 38
    expect(writes()).toEqual({ evidenceRows: 0, runs: 0 });
  });

  it("a careless run cannot retract an honest placement either", async () => {
    const ids = lemmaIds(PER_BAND * BANDS.length);
    const idsFor = (i: number) => ids.slice(i * PER_BAND, (i + 1) * PER_BAND);

    // An honest B1 placement, non-words correctly rejected.
    const honest = await place([
      ...BANDS.slice(0, 3).map((b, i) => band(b, 8, idsFor(i))).flat(),
      ...BANDS.slice(3).map((b, i) => band(b, 0, idsFor(i + 3))).flat(),
      ...pseudos(0),
    ]);
    expect(honest.level).toBe("B1");
    expect(honest.calibrated).toBe(true);
    expect(honest.seededRules).toBeGreaterThan(0);
    const afterHonest = writes();
    const planAfterHonest = planRefs();

    // Now a careless run. Refusing to seed is only half the promise: writing an EMPTY run
    // would supersede the B1 seeding and empty the plan, so the refusal must skip the run
    // row too. This is the assertion that pins "no run row" to a user-visible consequence.
    const careless = await place([...BANDS.map((b, i) => band(b, 8, idsFor(i))).flat(), ...pseudos(12)]);
    expect(careless.caveat).toBe("response-style");
    expect(careless.runId).toBeNull();
    expect(careless.supersededItems).toBe(0);

    expect(writes()).toEqual(afterHonest); // not one row added, not one run
    expect(currentPlacementRun(db)!.id).toBe(honest.runId);
    expect(currentPlacementRun(db)!.level).toBe("B1");
    expect(planRefs()).toEqual(planAfterHonest); // the honest placement still stands
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// N1 — a level needs every band MEASURED, not merely not-failed.
// ─────────────────────────────────────────────────────────────────────────────────────

describe("N1 · a band that was never asked cannot sit below a claimed level", () => {
  const ids = () => lemmaIds(PER_BAND);

  it("the crafted 16-answer submission is refused by the scorer", () => {
    // 8 C2 words known + 8 non-words rejected. Measured before the fix:
    // level "C2", calibrated TRUE, caveat null, contiguous true, fa 0, seededRules 238.
    const r = scorePlacement([...band("C2", 8, ids()), ...pseudos(0, 8)]);
    expect(r.falseAlarmRate).toBe(0);
    expect(r.level).toBeNull();
    expect(r.calibrated).toBe(false);
    expect(r.caveat).toBe("thin-sample");
    // The diagnostic still reports what the answers showed — C2 did clear.
    expect(r.highestCleared).toBe("C2");
    // A1…C1 were never asked, and that is now visible rather than transparent.
    expect(r.bands.filter((b) => b.presented === 0).map((b) => b.band)).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
      "C1",
    ]);
  });

  it("and the route seeds no grammar from it — the DB matches the refusal", async () => {
    const before = writes();
    const r = await place([...band("C2", 8, ids()), ...pseudos(0, 8)]);
    expect(r.level).toBeNull();
    expect(r.caveat).toBe("thin-sample");
    expect(r.seededRules).toBe(0); // was 238

    // A thin sample is still a partial measurement, so unlike a response-style run it is
    // recorded — and every word it claims to have noted is in the log, one row each.
    expect(r.runId).not.toBeNull();
    const seeded = db
      .prepare("SELECT COUNT(*) AS n FROM evidence WHERE source='placement' AND source_ref = ?")
      .get(`placement:${r.runId}`) as { n: number };
    expect(seeded.n).toBe(r.seededWords);
    expect(writes().runs).toBe(before.runs + 1);

    // No advanced grammar was minted on the way — the harm the crafted POST used to do.
    const advanced = db
      .prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='rule' AND cefr IN ('B2','C1','C2') AND status <> 'unseen'")
      .get() as { n: number };
    expect(advanced.n).toBe(0);
  });

  it("a single under-measured band breaks the run, even mid-scale", () => {
    // Every band at 8 except B1 at 3 (below MIN_PER_BAND), all known, non-words rejected.
    const r = scorePlacement([
      ...band("A1", 8, ids()),
      ...band("A2", 8, ids()),
      ...Array.from({ length: 3 }, (_, i) => ({ kind: "real" as const, band: "B1" as Band, itemId: ids()[i], known: true })),
      ...band("B2", 8, ids()),
      ...band("C1", 8, ids()),
      ...band("C2", 8, ids()),
      ...pseudos(0),
    ]);
    expect(r.level).toBe("A2"); // NOT C2 — the walk stops at the gap
    expect(r.highestCleared).toBe("C2");
    expect(r.caveat).toBe("thin-sample");
    expect(r.calibrated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// N2 — the threshold's boundary and its docstring must agree.
// ─────────────────────────────────────────────────────────────────────────────────────

describe("N2 · fa exactly at MAX_FALSE_ALARM_RATE is careless, as the comment says", () => {
  it("4 of 16 non-words claimed known: no level, no confidence, no writes", async () => {
    const ids = lemmaIds(PER_BAND);
    const atThreshold = Math.round(PSEUDO * MAX_FALSE_ALARM_RATE); // 4 of 16 — exactly 0.25
    const before = writes();

    const r = await place([...BANDS.map((b) => band(b, 8, ids)).flat(), ...pseudos(atThreshold)]);

    // Exactly ON the boundary, expressed through the constant so it cannot drift.
    expect(r.falseAlarmRate).toBe(MAX_FALSE_ALARM_RATE);
    // Measured before the fix: level "C2", calibrated true, caveat null, seededRules 238.
    expect(r.calibrated).toBe(false);
    expect(r.caveat).toBe("response-style");
    expect(r.level).toBeNull();
    expect(r.seededWords).toBe(0);
    expect(r.seededRules).toBe(0);
    expect(writes()).toEqual(before);
  });

  it("just below the boundary is still a measurement — the fix did not swallow the range", () => {
    const ids = lemmaIds(PER_BAND);
    const r = scorePlacement([...BANDS.map((b) => band(b, 8, ids)).flat(), ...pseudos(3)]); // fa 0.1875
    expect(r.falseAlarmRate).toBeLessThan(MAX_FALSE_ALARM_RATE);
    expect(r.level).toBe("C2");
    expect(r.calibrated).toBe(true);
    expect(r.caveat).toBeNull();
  });
});
