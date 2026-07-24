import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";
import type { Db } from "@/lib/db";
import type { NewFinding } from "@/lib/analysis/findings";

// E-37 criteria 4 + 5: where pronunciation signal GOES, and what a passing drill is
// allowed to write.
//
// ROUTING (RETRO-002 P4 / RETRO-003). Two producers of pronunciation signal exist and
// both used to dead-end in a typed cloze that could not test the thing it was about:
// the `pronunciation` finding category, and the E-28 `notes.pronunciation` richness
// note (which rides on a finding of ANY category). Both must reach the studio as
// drills, read through lib/findings-model.ts (E-17), and the pronunciation-category
// finding must no longer be handled by the old card path.
//
// EVIDENCE (D-19). A passing drill may only write CUED evidence through the one
// `recordEvidence` door, and cued evidence can never reach `known` — a scripted drill
// is prompted production, and `known` demands a spontaneous positive. A too-noisy take
// writes nothing at all.

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let generateCards: typeof import("@/lib/cards").generateCards;
let listPronunciationDrills: typeof import("@/lib/pronunciation").listPronunciationDrills;
let resolveDrill: typeof import("@/lib/pronunciation").resolveDrill;
let pronunciationDrill: typeof import("@/lib/pronunciation").pronunciationDrill;
let drillKeyForFinding: typeof import("@/lib/pronunciation").drillKeyForFinding;
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

const GRAMMAR_WITH_NOTE: NewFinding = {
  quote: "una problema",
  correction: "un problema",
  category: "grammar",
  explanation: "masculine",
  severity: "medium",
  startMs: 3000,
  endMs: 4000,
  notes: { pronunciation: "the double b in problema is clipped" },
};

const PLAIN_GRAMMAR: NewFinding = {
  quote: "ho andato",
  correction: "sono andato",
  category: "grammar",
  explanation: "essere with andare",
  severity: "high",
  startMs: 5000,
  endMs: 6000,
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

function findingIdByQuote(db: Db, quote: string): string {
  return (db.prepare("SELECT id FROM findings WHERE quote = ?").get(quote) as { id: string }).id;
}

beforeAll(async () => {
  root = tmpDir("erika-pron-routing-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  generateCards = (await import("@/lib/cards")).generateCards;
  const pron = await import("@/lib/pronunciation");
  listPronunciationDrills = pron.listPronunciationDrills;
  resolveDrill = pron.resolveDrill;
  pronunciationDrill = pron.pronunciationDrill;
  drillKeyForFinding = pron.drillKeyForFinding;
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

describe("E-37 criterion 4 — pronunciation signal routes to the studio", () => {
  it("a pronunciation FINDING produces a drill whose target is the CORRECTION (D-18)", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drills = listPronunciationDrills(db);
    expect(drills).toHaveLength(1);
    expect(drills[0].referenceText).toBe(PRON_FINDING.correction);
    // The learner's error is never the thing they are asked to say.
    expect(drills[0].referenceText).not.toBe(PRON_FINDING.quote);
    expect(drills[0].source).toBe("finding");
  });

  it("a `notes.pronunciation` note on a NON-pronunciation finding also produces a drill", () => {
    const db = freshDb();
    seed(db, [GRAMMAR_WITH_NOTE, PLAIN_GRAMMAR]);
    const drills = listPronunciationDrills(db);
    // The richness note rides on a grammar finding — and is likely the larger signal.
    expect(drills.map((d) => d.referenceText)).toEqual(["un problema"]);
    expect(drills[0].suspect).toBe("the double b in problema is clipped");
    // A finding with neither the category nor the note is not a drill.
    expect(drills.some((d) => d.referenceText === "sono andato")).toBe(false);
  });

  it("the OLD CLOZE PATH no longer handles a pronunciation finding", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING, PLAIN_GRAMMAR]);
    const created = generateCards(db);
    const carded = db.prepare("SELECT category FROM cards").all() as { category: string }[];
    // Only the grammar finding becomes a card; the pronunciation finding does not.
    expect(created).toBe(1);
    expect(carded.map((c) => c.category)).toEqual(["grammar"]);
    // …and the one that lost its card is exactly the one the studio now owns.
    expect(listPronunciationDrills(db).map((d) => d.referenceText)).toEqual([PRON_FINDING.correction]);
  });

  it("resolves a drill only through its producer — an arbitrary key is refused", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING, PLAIN_GRAMMAR]);
    const pronId = findingIdByQuote(db, PRON_FINDING.quote);
    expect(resolveDrill(db, drillKeyForFinding(pronId))!.referenceText).toBe(PRON_FINDING.correction);
    // A grammar-only finding is not a drill, however you address it.
    expect(resolveDrill(db, drillKeyForFinding(findingIdByQuote(db, PLAIN_GRAMMAR.quote)))).toBeNull();
    expect(resolveDrill(db, "finding:does-not-exist")).toBeNull();
    expect(resolveDrill(db, "tutor:some-observation")).toBeNull(); // no such producer yet
    expect(resolveDrill(db, "malformed-key")).toBeNull();
  });

  it("a finding outside the E-17 included scope yields no drill (one findings gate)", () => {
    const db = freshDb();
    createSession(db, { id: "s9", originalFilename: "s9.wav", format: "wav", sizeBytes: 1, durationSeconds: 10 });
    // A findings row whose audio carries NO analysis witness — invisible everywhere else.
    db.prepare(
      `INSERT INTO findings (id, session_id, content_hash, quote, correction, category, explanation, severity, start_ms, end_ms)
       VALUES ('f-orphan', 's9', 'no-witness', 'li', 'gli', 'pronunciation', 'why', 'low', 0, 100)`,
    ).run();
    expect(listPronunciationDrills(db)).toEqual([]);
    expect(pronunciationDrill(db, "f-orphan")).toBeNull();
  });

  it("a scored pronunciation finding stops recurring as unspent composer material", async () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const before = compose(db, "2026-07-24", DEFAULT_CAPS);
    expect(before.counts.finding).toBe(1);

    const drill = listPronunciationDrills(db)[0];
    const take = path.join(root, "routing-take.wav");
    makeWav(take, 2);
    await scoreAttempt(db, createFixtureScorer("clean"), { drill, audioPath: take, audioSeconds: 2 });

    // Without this, a pronunciation finding — which now has no card to grade — would
    // sit in every day's plan forever, unspendable.
    const after = compose(db, "2026-07-24", DEFAULT_CAPS);
    expect(after.counts.finding).toBe(0);
  });
});

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
