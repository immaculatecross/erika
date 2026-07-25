import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";
import type { Db } from "@/lib/db";
import type { NewFinding } from "@/lib/analysis/findings";
import { drillFitsShortAudio, drillGate, MAX_DRILL_REFERENCE_CHARS } from "@/lib/pronunciation/types";

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
let pinFinding: typeof import("@/lib/cards").pinFinding;
let createCardForFinding: typeof import("@/lib/cards").createCardForFinding;
let deriveFront: typeof import("@/lib/cards-view").deriveFront;
let CLOZE_BLANK: typeof import("@/lib/cards-view").CLOZE_BLANK;
let studioDrillPath: typeof import("@/lib/pronunciation").studioDrillPath;
let listIncludedFindings: typeof import("@/lib/findings-model").listIncludedFindings;
let listPronunciationDrills: typeof import("@/lib/pronunciation").listPronunciationDrills;
let resolveDrill: typeof import("@/lib/pronunciation").resolveDrill;
let pronunciationDrill: typeof import("@/lib/pronunciation").pronunciationDrill;
let drillKeyForFinding: typeof import("@/lib/pronunciation").drillKeyForFinding;
let scoreAttempt: typeof import("@/lib/pronunciation").scoreAttempt;
let recordVisit: typeof import("@/lib/pronunciation").recordVisit;
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
  const cards = await import("@/lib/cards");
  generateCards = cards.generateCards;
  pinFinding = cards.pinFinding;
  createCardForFinding = cards.createCardForFinding;
  const cardsView = await import("@/lib/cards-view");
  deriveFront = cardsView.deriveFront;
  CLOZE_BLANK = cardsView.CLOZE_BLANK;
  const pron = await import("@/lib/pronunciation");
  listPronunciationDrills = pron.listPronunciationDrills;
  resolveDrill = pron.resolveDrill;
  pronunciationDrill = pron.pronunciationDrill;
  drillKeyForFinding = pron.drillKeyForFinding;
  studioDrillPath = pron.studioDrillPath;
  listIncludedFindings = (await import("@/lib/findings-model")).listIncludedFindings;
  scoreAttempt = pron.scoreAttempt;
  recordVisit = pron.recordVisit;
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

  // The bulk exclusion above and this pin are the ONLY two paths that mint a card, and
  // they are pinned together deliberately: an explicit user act does not make an
  // unanswerable card acceptable, it just means we broke it on request.
  it("the deliberate Phrasebook PIN also refuses to mint a degraded pronunciation card", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING, PLAIN_GRAMMAR]);
    const pronId = findingIdByQuote(db, PRON_FINDING.quote);
    const grammarId = findingIdByQuote(db, PLAIN_GRAMMAR.quote);

    // This is what the pin WOULD have handed the learner: an unanswerable prompt,
    // because the pronunciation finding's spelling was never wrong (RETRO-003).
    expect(deriveFront(PRON_FINDING.quote, PRON_FINDING.correction, "pronunciation")).toBe(
      `${CLOZE_BLANK} · pronunciation`,
    );

    const refused = pinFinding(db, pronId);
    expect(refused.status).toBe("not_cardable");
    expect(refused).toMatchObject({ category: "pronunciation" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE finding_id = ?").get(pronId)).toEqual({ n: 0 });
    // The legacy signature refuses too — no caller can slip past the rule.
    expect(createCardForFinding(db, pronId)).toBeNull();
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE finding_id = ?").get(pronId)).toEqual({ n: 0 });

    // A normal finding still pins exactly as before — the rule is narrow.
    const pinned = pinFinding(db, grammarId);
    expect(pinned.status).toBe("pinned");
    expect(db.prepare("SELECT COUNT(*) AS n FROM cards WHERE finding_id = ?").get(grammarId)).toEqual({ n: 1 });

    // A missing finding is still distinguishable from a refused one.
    expect(pinFinding(db, "no-such-finding").status).toBe("not_found");
  });

  it("the learner is directed to the drill instead — the surface that can practise it", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const pronId = findingIdByQuote(db, PRON_FINDING.quote);

    // The route's pointer resolves to a real, resolvable drill for that same finding.
    const key = drillKeyForFinding(pronId);
    expect(studioDrillPath(key)).toBe(`/practice/learn/studio/${encodeURIComponent(key)}`);
    const drill = resolveDrill(db, key);
    expect(drill).not.toBeNull();
    expect(drill!.referenceText).toBe(PRON_FINDING.correction); // the correct line (D-18)
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

    const after = compose(db, "2026-07-24", DEFAULT_CAPS);
    expect(after.counts.finding).toBe(0);
  });

  // [F1 — the review's headline defect] A pronunciation finding gets NO card, so only
  // the studio can retire it. Gating that on a SCORED attempt made it unspendable on the
  // shipped default (no Azure key ⇒ `scoreAttempt` throws before writing anything), and
  // it re-entered the plan every single day forever, silently eating a `dailyMax` slot
  // ahead of fresh material. The spend condition must exist WITHOUT a key.
  it("[no key] a pronunciation finding retires after a studio VISIT — it does not loop forever", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];

    // Nothing scored, nothing billed — this is exactly what the shipped default can do.
    expect(compose(db, "2026-07-24", DEFAULT_CAPS).counts.finding).toBe(1);
    recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });

    // Retired the same day, and still retired on days the old code kept re-serving it.
    for (const day of ["2026-07-24", "2026-08-15", "2027-06-01"]) {
      expect(compose(db, day, DEFAULT_CAPS).counts.finding).toBe(0);
    }
    // And no money or score was invented along the way.
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n).toBe(0);
  });

  // [N1] The counterpart to the test above: when the rendition could not be played the
  // learner may still practise, but that lap must not spend the correction. Recording
  // without ever hearing the target is not the drill, and a visit is permanent.
  it("[no key] an UNHEARD lap records no visit — the finding stays on the list", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];

    // The rendition failed (402 at the cap, or a transient TTS error): the gate allows
    // recording but refuses to count the lap.
    const gate = drillGate({ heard: false, renditionUnavailable: true, renditionImpossible: false });
    expect(gate.canRecord).toBe(true);
    expect(gate.visitCounts).toBe(false);

    // So the page posts no visit — and the finding is still owed to the learner.
    if (gate.visitCounts) recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    expect((db.prepare("SELECT COUNT(*) AS n FROM pronunciation_visits").get() as { n: number }).n).toBe(0);
    for (const day of ["2026-07-24", "2026-08-15", "2027-06-01"]) {
      expect(compose(db, day, DEFAULT_CAPS).counts.finding).toBe(1);
    }

    // Once they DO hear it, the same lap retires it.
    const heardGate = drillGate({ heard: true, renditionUnavailable: true, renditionImpossible: false });
    expect(heardGate.visitCounts).toBe(true);
    recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    expect(compose(db, "2026-07-24", DEFAULT_CAPS).counts.finding).toBe(0);
  });

  // [N2] The same forever-loop through a different door: a correction too long for the
  // short-audio path can never have a drill, so it can never have a visit or an attempt
  // — waiting on one would loop it forever.
  it("a correction too long to drill is not offered forever — and is never a drill", () => {
    const db = freshDb();
    const longCorrection = `Quando ${"parlo di questa cosa molto complicata ".repeat(20)}basta.`;
    expect(longCorrection.length).toBeGreaterThan(MAX_DRILL_REFERENCE_CHARS);
    seed(db, [
      {
        quote: "una versione sbagliata",
        correction: longCorrection,
        category: "pronunciation",
        explanation: "far too long to say in one breath",
        severity: "low",
        startMs: 0,
        endMs: 1000,
      },
    ]);

    // There is no drill for it anywhere — so no visit and no attempt can ever exist.
    expect(listPronunciationDrills(db)).toEqual([]);
    const findingId = findingIdByQuote(db, "una versione sbagliata");
    expect(resolveDrill(db, drillKeyForFinding(findingId))).toBeNull();
    // It gets no card either (uncardable category).
    expect(generateCards(db)).toBe(0);

    // It must therefore not sit in the plan waiting for a drill that cannot exist.
    for (const day of ["2026-07-24", "2026-08-15", "2027-06-01"]) {
      expect(compose(db, day, DEFAULT_CAPS).counts.finding).toBe(0);
    }
    // It is still fully present as a finding — this is the composer's plan, not the
    // E-17 findings scope.
    expect(listIncludedFindings(db).map((f) => f.id)).toContain(findingId);
  });

  // [N-e] The JS rule and the composer's SQL rule must agree, or a finding is drillable by
  // one and unspendable by the other — N2's forever loop, or a finding retired while its
  // drill still works. SQLite's bare `trim()` strips SPACES ONLY; these are the inputs
  // that exposed the gap.
  it("the JS and SQL drillability rules agree on whitespace-padded corrections", () => {
    const cases = [
      "\n\t \n", // whitespace only, not just spaces → blank to both
      `\n${"a".repeat(MAX_DRILL_REFERENCE_CHARS)}`, // 421 chars raw, 420 trimmed → drillable
      `\t${"b".repeat(MAX_DRILL_REFERENCE_CHARS + 1)}\n`, // still too long after trimming
      "   ", // spaces only
      "Gli gnocchi sono buonissimi",
    ];
    for (const correction of cases) {
      const db = freshDb();
      seed(db, [
        {
          quote: "q",
          correction,
          category: "pronunciation",
          explanation: "why",
          severity: "low",
          startMs: 0,
          endMs: 100,
        },
      ]);
      const js = drillFitsShortAudio(correction);
      // The composer's SQL verdict, read through its real clause: a finding it still
      // offers is one it believes has a drill waiting.
      const sqlSaysDrillable = compose(db, "2026-07-25", DEFAULT_CAPS).counts.finding === 1;
      expect(sqlSaysDrillable, `disagreement on ${JSON.stringify(correction)}`).toBe(js);
      // And the studio's own door agrees with the JS rule by construction.
      expect(listPronunciationDrills(db).length).toBe(js ? 1 : 0);
    }
  });

  it("a drillable pronunciation finding is NOT retired by the length rule", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    // Guard against the length predicate over-reaching: an ordinary correction still
    // waits for its drill.
    expect(PRON_FINDING.correction.length).toBeLessThanOrEqual(MAX_DRILL_REFERENCE_CHARS);
    expect(compose(db, "2026-07-24", DEFAULT_CAPS).counts.finding).toBe(1);
  });

  it("[no key] a visit is idempotent — repeating the loop bumps cycles, not rows", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];

    recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    const visit = recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    expect(visit.cycles).toBe(3);
    expect((db.prepare("SELECT COUNT(*) AS n FROM pronunciation_visits").get() as { n: number }).n).toBe(1);
  });

  it("a visit records ACTIVITY, never evidence — practising is not mastery (D-19/D-24)", () => {
    const db = freshDb();
    seed(db, [PRON_FINDING]);
    const drill = listPronunciationDrills(db)[0];
    recordVisit(db, { drillKey: drill.drillKey, findingId: drill.findingId });
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE kind = 'phone'").get() as { n: number }).n).toBe(0);
  });

  // [F3 — the cross-category leak] Studio drills also come from `notes.pronunciation`
  // riding on findings of OTHER categories. An unscoped attempt/visit clause let one
  // pronunciation take silently retire a GRAMMAR correction whose own card had never
  // been graded — the grammar lesson was lost without ever being taught.
  it("a studio take never retires a grammar finding whose card is still ungraded", async () => {
    const db = freshDb();
    seed(db, [GRAMMAR_WITH_NOTE, PRON_FINDING]);
    generateCards(db); // the grammar finding gets a card; the pronunciation one does not

    const before = compose(db, "2026-07-24", DEFAULT_CAPS);
    expect(before.counts.finding).toBe(2);

    // Drill the GRAMMAR finding's pronunciation note, both ways.
    const grammarDrill = listPronunciationDrills(db).find((d) => d.referenceText === "un problema")!;
    const take = path.join(root, "cross-category.wav");
    makeWav(take, 2);
    recordVisit(db, { drillKey: grammarDrill.drillKey, findingId: grammarDrill.findingId });
    await scoreAttempt(db, createFixtureScorer("clean"), {
      drill: grammarDrill,
      audioPath: take,
      audioSeconds: 2,
    });

    // The grammar finding is still unspent: its card exists and has never been graded,
    // so the grammar correction is still owed to the learner.
    const card = db
      .prepare("SELECT repetitions, suspended FROM cards WHERE finding_id = ?")
      .get(grammarDrill.findingId) as { repetitions: number; suspended: number };
    expect(card).toEqual({ repetitions: 0, suspended: 0 });
    expect(compose(db, "2026-07-24", DEFAULT_CAPS).counts.finding).toBe(2);

    // A visit on the PRONUNCIATION finding, which has no card, does retire that one.
    const pronDrill = listPronunciationDrills(db).find((d) => d.referenceText === PRON_FINDING.correction)!;
    recordVisit(db, { drillKey: pronDrill.drillKey, findingId: pronDrill.findingId });
    expect(compose(db, "2026-07-24", DEFAULT_CAPS).counts.finding).toBe(1);
  });
});
