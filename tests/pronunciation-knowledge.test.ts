import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";
import type { Db } from "@/lib/db";
import type { NewFinding } from "@/lib/analysis/findings";

// E-37 criterion 5: what a scored drill is allowed to write to the knowledge core
// (D-19). Split out of tests/pronunciation-routing.test.ts, which owns criterion 4
// (where pronunciation signal GOES), to keep both files under the 500-line cap.
//
// The invariant that matters: a passing drill may only write CUED evidence through the
// one `recordEvidence` door, and cued evidence can never reach `known` — a scripted
// drill is prompted production, and `known` demands a spontaneous positive. A too-noisy
// take writes nothing at all.

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let listPronunciationDrills: typeof import("@/lib/pronunciation").listPronunciationDrills;
let scoreAttempt: typeof import("@/lib/pronunciation").scoreAttempt;
let createFixtureScorer: typeof import("@/lib/pronunciation/fixture-scorer").createFixtureScorer;
let ensurePhoneItem: typeof import("@/lib/knowledge/items").ensurePhoneItem;
let getItem: typeof import("@/lib/knowledge/items").getItem;
let itemEvidence: typeof import("@/lib/knowledge/derive").itemEvidence;
let compose: typeof import("@/lib/compose").compose;
let DEFAULT_CAPS: typeof import("@/lib/compose").DEFAULT_CAPS;

let dbSeq = 0;
function freshDb(): Db {
  return openDatabase(path.join(root, `db-${dbSeq++}.sqlite`));
}

const PRON_FINDING: NewFinding = {
  quote: "li gnocchi",
  correction: "Gli gnocchi sono buonissimi",
  category: "pronunciation",
  explanation: "the palatal lateral in gli",
  severity: "high",
  startMs: 0,
  endMs: 2000,
};

function seed(db: Db, findings: NewFinding[], sessionId = "s1"): void {
  createSession(db, {
    id: sessionId,
    originalFilename: `${sessionId}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 60,
  });
  persistSegmentFindings(db, {
    sessionId,
    contentHash: `${sessionId}-hash`,
    flagged: true,
    deepDone: true,
    findings,
  });
}

beforeAll(async () => {
  root = tmpDir("erika-pron-knowledge-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  const pron = await import("@/lib/pronunciation");
  listPronunciationDrills = pron.listPronunciationDrills;
  scoreAttempt = pron.scoreAttempt;
  createFixtureScorer = (await import("@/lib/pronunciation/fixture-scorer")).createFixtureScorer;
  const items = await import("@/lib/knowledge/items");
  ensurePhoneItem = items.ensurePhoneItem;
  getItem = items.getItem;
  itemEvidence = (await import("@/lib/knowledge/derive")).itemEvidence;
  const composeMod = await import("@/lib/compose");
  compose = composeMod.compose;
  DEFAULT_CAPS = composeMod.DEFAULT_CAPS;
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("E-37 criterion 5 — what a drill may write to the knowledge core (D-19)", () => {
  it("seeds a phone item for a sound produced BELOW the shaky band, with no evidence row", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "weak-take.wav");
    makeWav(take, 2);

    const { seeded } = await scoreAttempt(db, createFixtureScorer("gli-gnocchi"), {
      drill,
      audioPath: take,
      audioSeconds: 2,
    });

    // /ʎ/ scored 24 and /ɲ/ 44 — both under the shaky mark of 60.
    expect(seeded).toContain("phone:ʎ");
    expect(seeded).toContain("phone:ɲ");
    expect(getItem(db, "phone:ʎ")!.status).toBe("unseen"); // a target, not a verdict
    expect(itemEvidence(db, "phone:ʎ")).toEqual([]);

    // And the composer can now offer it — this is what un-inerts the "Sounds" cap.
    const plan = compose(db, "2026-07-24", DEFAULT_CAPS);
    expect(plan.items.some((i) => i.kind === "pronunciation" && i.itemId === "phone:ʎ")).toBe(true);
  });

  it("mints CUED positive evidence for a well-produced sound on a PASSING take", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "clean-take.wav");
    makeWav(take, 2);

    // /r/ is already on the learner's list from an earlier miss.
    ensurePhoneItem(db, "r");

    const { attempt, credited } = await scoreAttempt(db, createFixtureScorer("clean"), {
      drill,
      audioPath: take,
      audioSeconds: 2,
    });

    expect(credited).toContain("phone:r");
    const rows = itemEvidence(db, "phone:r");
    expect(rows).toHaveLength(1);
    expect(rows[0].mode).toBe("cued"); // a scripted drill is prompted, never spontaneous
    expect(rows[0].polarity).toBe(1);
    expect(rows[0].source).toBe("exercise");
    expect(rows[0].sourceRef).toBe(attempt.id);
    expect(rows[0].weight).toBeCloseTo(0.6 * 0.7, 10); // cued × the audio discount
  });

  it("NEVER mints `known` — cued drills alone cannot corroborate mastery", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "many-takes.wav");
    makeWav(take, 2);
    ensurePhoneItem(db, "r");

    // Drill it over and over — many days' worth of passing takes.
    for (let i = 0; i < 6; i++) {
      await scoreAttempt(db, createFixtureScorer("clean"), { drill, audioPath: take, audioSeconds: 2 });
    }
    const item = getItem(db, "phone:r")!;
    expect(itemEvidence(db, "phone:r").length).toBe(6);
    expect(item.status).not.toBe("known");
    expect(["introduced", "learning", "lapsed"]).toContain(item.status);
  });

  it("a FAILING take mints no positive evidence, even for its good sounds", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "failing-take.wav");
    makeWav(take, 2);
    ensurePhoneItem(db, "s"); // /s/ scored 96 in the gli-gnocchi fixture…

    const { credited } = await scoreAttempt(db, createFixtureScorer("gli-gnocchi"), {
      drill,
      audioPath: take,
      audioSeconds: 2,
    });
    // …but the take as a whole did not pass (77.2 < 80), so nothing is credited.
    expect(credited).toEqual([]);
    expect(itemEvidence(db, "phone:s")).toEqual([]);
  });

  it("a TOO-NOISY take writes nothing to the knowledge core (it described the room)", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "noisy-take.wav");
    makeWav(take, 2);
    ensurePhoneItem(db, "r");

    const { attempt, seeded, credited } = await scoreAttempt(db, createFixtureScorer("noisy"), {
      drill,
      audioPath: take,
      audioSeconds: 2,
    });

    expect(attempt.lowSnr).toBe(true);
    expect(seeded).toEqual([]);
    expect(credited).toEqual([]);
    expect(itemEvidence(db, "phone:r")).toEqual([]);
    // The take is still STORED with its charge — Azure was paid, and the ledger and the
    // record must agree — it is only never presented as a measurement.
    expect(attempt.costUsd).toBeGreaterThan(0);
  });

  it("stores the whole parsed result and the scorer's identity, so a score is traceable", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "trace-take.wav");
    makeWav(take, 2);

    const { attempt } = await scoreAttempt(db, createFixtureScorer("gli-gnocchi"), {
      drill,
      audioPath: take,
      audioSeconds: 2,
    });
    expect(attempt.scorerId).toBe("fixture:gli-gnocchi"); // never mistaken for a real run
    expect(attempt.referenceText).toBe(PRON_FINDING.correction);
    expect(attempt.result.words[0].phonemes[0].nBest[0].phoneme).toBe("l");
    expect(attempt.drillKey).toBe(drill.drillKey);
    expect(attempt.findingId).toBe(drill.findingId);
  });
});
