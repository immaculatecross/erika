import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { levelLine } from "@/lib/placement/result-copy";
import { BANDS, type Band, type PlacementAnswer } from "@/lib/placement/scoring";
import type { Db } from "@/lib/db";

// REVIEW-64 F3/F4 — the SENTENCE the learner reads, tested the way its writes are.
//
// F3: `levelLine` lived inline and unexported in `app/practice/placement/page.tsx`. The
// reviewer restored the exact pre-PR false sentence and the entire 994-test suite stayed
// green — nothing anywhere asserted on the copy, only comments mentioned it, and `npm test`
// never runs playwright. So the PR's central claim, that the copy reads the server's counts
// and cannot drift from them, was enforced by prose. F4 is what got through that gap.
//
// F4: `unplaceableLine` read `seededWords` and ignored `supersededItems`. A `thin-sample` or
// `inconsistent` run yields `level: null` but IS recorded, which supersedes the previous
// placement — so an honest learner (fa 0, every invented word correctly rejected) could place
// at B2 and then have all 173 seeded rules dropped by an uneven retake while the screen said
// "and nothing else has changed".
//
// Every line below is rendered from a REAL `POST /api/placement` response, and paired with
// the database that response describes. Hand-written inputs would have missed F4 exactly as
// the prose did: the field that was wrong is one nobody thought to write down.

let root: string;
let db: Db;
let PLACEMENT_POST: typeof import("@/app/api/placement/route").POST;
let buildLearnItems: typeof import("@/lib/learn-items").buildLearnItems;

beforeAll(async () => {
  root = tmpDir("erika-placement-copy-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  PLACEMENT_POST = (await import("@/app/api/placement/route")).POST;
  buildLearnItems = (await import("@/lib/learn-items")).buildLearnItems;
  db = (await import("@/lib/db")).getDb();
});

const PER_BAND = 8;
const PSEUDO = 16;

function band(b: Band, yes: number, ids: string[], n = PER_BAND): PlacementAnswer[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "real" as const, band: b, itemId: ids[i], known: i < yes }));
}
function pseudos(yes: number, n = PSEUDO): PlacementAnswer[] {
  return Array.from({ length: n }, (_, i) => ({ kind: "pseudo" as const, known: i < yes }));
}
function lemmaIds(count: number): string[] {
  return (
    db.prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT ?").all(count) as {
      id: string;
    }[]
  ).map((r) => r.id);
}

interface PlaceResponse {
  level: Band | null;
  calibrated: boolean;
  caveat: "no-control" | "response-style" | "inconsistent" | "thin-sample" | null;
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

/** Grammar rules the model currently considers seen — what a retraction empties. */
function rulesSeen(): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE kind='rule' AND status <> 'unseen'").get() as {
      n: number;
    }
  ).n;
}
function planRefs(): string[] {
  return buildLearnItems(db).items.map((i) => `${i.kind}:${i.detail}:${i.itemId}`);
}

describe("the placement sentence says what the run actually did (REVIEW-64 F3/F4)", () => {
  const ids = () => lemmaIds(PER_BAND * BANDS.length);
  const idsFor = (all: string[], i: number) => all.slice(i * PER_BAND, (i + 1) * PER_BAND);

  it("an honest placement states its level and both counts, and they match the DB", async () => {
    const all = ids();
    // Honest B2: A1/A2/B1 known, B2 mostly, C1 barely, C2 not; every non-word rejected.
    const r = await place([
      ...band("A1", 8, idsFor(all, 0)),
      ...band("A2", 8, idsFor(all, 1)),
      ...band("B1", 8, idsFor(all, 2)),
      ...band("B2", 6, idsFor(all, 3)),
      ...band("C1", 1, idsFor(all, 4)),
      ...band("C2", 0, idsFor(all, 5)),
      ...pseudos(0),
    ]);
    expect(r.level).toBe("B2");
    expect(r.calibrated).toBe(true);
    expect(levelLine(r)).toBe(
      `Placed around B2. ${r.seededWords} words you knew are now in your model. ${r.seededRules} grammar points below it are marked seen.`,
    );
    // The two numbers in that sentence are the database, not decoration.
    expect(rulesSeen()).toBe(r.seededRules);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM evidence WHERE source='placement' AND source_ref = ?")
          .get(`placement:${r.runId}`) as { n: number }
      ).n,
    ).toBe(r.seededWords + r.seededRules);
  });

  // ── F4. The state that was lying, and the one that was lying loudest.
  it("an uneven retake that RETRACTS a placement says the plan changed", async () => {
    const all = ids();
    const seenBefore = rulesSeen();
    const planBefore = planRefs();
    expect(seenBefore).toBeGreaterThan(100); // the B2 placement above is still standing

    // An honest responder: fa 0, every invented word correctly rejected. Uneven recognition.
    const r = await place([
      ...band("A1", 3, idsFor(all, 0)),
      ...band("A2", 2, idsFor(all, 1)),
      ...band("B1", 5, idsFor(all, 2)),
      ...band("B2", 1, idsFor(all, 3)),
      ...band("C1", 0, idsFor(all, 4)),
      ...band("C2", 0, idsFor(all, 5)),
      ...pseudos(0),
    ]);
    expect(r.falseAlarmRate).toBe(0); // NOT a careless learner
    expect(r.level).toBeNull();
    expect(r.caveat).toBe("inconsistent");
    expect(r.runId).not.toBeNull(); // recorded, therefore superseding
    expect(r.supersededItems).toBeGreaterThan(100);

    // The retraction really happened: the previous level's grammar left the model and the plan.
    expect(rulesSeen()).toBeLessThan(seenBefore);
    expect(planRefs()).not.toEqual(planBefore);

    const line = levelLine(r);
    expect(line).toBe(
      "The check could not place you. Recognition was uneven — some less common words were marked known while more common ones were not. " +
        `No level has been assumed. The ${r.seededWords} words you marked as known are noted. ` +
        `The ${r.supersededItems} items your previous check had marked as seen are no longer counted, so your daily plan has changed. ` +
        "You can take the check again whenever you like.",
    );
    // The sentence this PR exists to delete must not reappear on a run that DID change things.
    expect(line).not.toContain("nothing else has changed");
    expect(line).not.toContain("your daily plan is unchanged");
    // And the old `inconsistent` reason claimed a level had been counted when none was.
    expect(line).not.toContain("only the run from the most common words up is counted");
  });

  it("a run that adds nothing AND retracts everything says exactly that", async () => {
    const all = ids();
    // Re-place honestly at C2 so there is a full syllabus to retract.
    const c2 = await place([...BANDS.map((b, i) => band(b, 8, idsFor(all, i))).flat(), ...pseudos(0)]);
    expect(c2.level).toBe("C2");
    const seenBefore = rulesSeen();
    expect(seenBefore).toBeGreaterThan(100);

    // A thin submission that knows nothing: level null, ZERO words seeded, and it supersedes.
    const r = await place([...BANDS.map((b, i) => band(b, 0, idsFor(all, i), 4)).flat(), ...pseudos(0, 4)]);
    expect(r.level).toBeNull();
    expect(r.caveat).toBe("thin-sample");
    expect(r.seededWords).toBe(0);
    expect(r.seededRules).toBe(0);
    expect(r.supersededItems).toBeGreaterThan(100);
    expect(rulesSeen()).toBeLessThan(seenBefore);

    const line = levelLine(r);
    expect(line).toContain("Nothing has been assumed about your level, and nothing was added to your model.");
    expect(line).toContain(
      `The ${r.supersededItems} items your previous check had marked as seen are no longer counted, so your daily plan has changed.`,
    );
    // THE SENTENCE. Verbatim what this PR exists to make true — false in the other direction
    // until F4, on a run that dropped a whole syllabus.
    expect(line).not.toContain("your daily plan is unchanged");
  });

  it("a careless run wrote nothing and retracted nothing, and says both", async () => {
    const all = ids();
    const seenBefore = rulesSeen();
    const planBefore = planRefs();
    const r = await place([...BANDS.map((b, i) => band(b, 8, idsFor(all, i))).flat(), ...pseudos(9)]);
    expect(r.caveat).toBe("response-style");
    expect(r).toMatchObject({ level: null, runId: null, seededWords: 0, seededRules: 0, supersededItems: 0 });

    expect(levelLine(r)).toBe(
      "The check could not place you. Several invented words were marked known, so the answers cannot separate the words you know from the ones you do not. " +
        "Nothing has been assumed about your level, and nothing was added to your model. Your daily plan is unchanged. " +
        "You can take the check again whenever you like.",
    );
    // …and the database backs every clause of it.
    expect(rulesSeen()).toBe(seenBefore);
    expect(planRefs()).toEqual(planBefore);
  });

  it("a submission with no invented words at all is refused, and named as such (N3)", async () => {
    const all = ids();
    const seenBefore = rulesSeen();
    const r = await place(BANDS.map((b, i) => band(b, 8, idsFor(all, i))).flat()); // zero pseudowords
    expect(r.caveat).toBe("no-control");
    expect(r).toMatchObject({ level: null, runId: null, seededWords: 0, seededRules: 0 });
    expect(levelLine(r)).toContain(
      "The check included no invented words, so there was no way to tell a real yes from a guess.",
    );
    expect(levelLine(r)).toContain("nothing was added to your model");
    expect(rulesSeen()).toBe(seenBefore);
  });

  it("the true beginner reads plainly, with no hedging at all", async () => {
    const all = ids();
    // Every band asked, nothing recognized, every non-word correctly rejected: a real
    // measurement of a real beginner. `caveat` is null, so this must NOT get the refusal line.
    const r = await place([...BANDS.map((b, i) => band(b, 0, idsFor(all, i))).flat(), ...pseudos(0)]);
    expect(r.level).toBeNull();
    expect(r.caveat).toBeNull();
    expect(r.calibrated).toBe(true);
    expect(levelLine(r)).toBe("Placed at the very start.");
  });

  it("a failed submission is not reported as a placement (N5)", () => {
    // Exactly what `submit()`'s catch now sets. Before: `{level: null, caveat: undefined}`,
    // which rendered "Placed at the very start. This is a rough placement." — a placement the
    // app never received, for a learner who may be a fluent C2.
    const line = levelLine({
      level: null,
      calibrated: false,
      seededWords: 0,
      seededRules: 0,
      supersededItems: 0,
      submitFailed: true,
    });
    expect(line).toBe(
      "Your answers could not be sent, so the check was not scored and nothing has changed. You can try again whenever you like.",
    );
    expect(line).not.toContain("Placed");
  });

  // Writing this test is what found it: the placed branch read "1 word you knew ARE now in
  // your model" — an inline, unexported, untested sentence for two releases.
  it("singulars read as English", () => {
    expect(
      levelLine({ level: "A1", calibrated: true, caveat: null, seededWords: 1, seededRules: 1, supersededItems: 0 }),
    ).toBe("Placed around A1. 1 word you knew is now in your model. 1 grammar point below it is marked seen.");
    expect(
      levelLine({
        level: null,
        calibrated: false,
        caveat: "inconsistent",
        seededWords: 1,
        seededRules: 0,
        supersededItems: 1,
      }),
    ).toBe(
      "The check could not place you. Recognition was uneven — some less common words were marked known while more common ones were not. " +
        "No level has been assumed. The 1 word you marked as known is noted. " +
        "The 1 item your previous check had marked as seen is no longer counted, so your daily plan has changed. " +
        "You can take the check again whenever you like.",
    );
  });
});
