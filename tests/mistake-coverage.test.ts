import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { renditionCachePath, segmentPath } from "@/lib/audio-storage";
import { enqueueAnalysis, runAnalysisJob } from "@/lib/analysis/cascade";
import { deepPrompt, parseDeepResponse, ModelParseError, type AudioModelClient } from "@/lib/analysis/audio-model";
import { CATEGORIES, normalizeCategory, type Category } from "@/lib/analysis/findings";
import {
  findingTallies,
  listIncludedFindings,
  listIncludedFindingsWithSession,
  listSessionFindings,
} from "@/lib/findings-model";
import { categoryCounts } from "@/lib/analysis-view";
import { buildEntries as buildPhrasebook } from "@/lib/phrasebook";
import { buildEntries as buildArchive } from "@/lib/archive";
import { buildFocusModel } from "@/lib/focus";
import { listSlips, materializeSlips } from "@/lib/slips";
import { listShadowDrills } from "@/lib/shadow";
import { listPronunciationDrills } from "@/lib/pronunciation/drills";
import { generateCards, listCards } from "@/lib/cards";
import { buildTutorPersona } from "@/lib/tutor/persona";

// ─────────────────────────────────────────────────────────────────────────────
// E-39 workstream A: the product's central promise — "we catch your mistakes" —
// under test rather than under assertion.
//
// Three things are proved here, in ascending order of what they cost to break:
//
//  1. ONE DEFINITION of a mistake. The tutor persona and the Record deep prompt both
//     compose lib/mistakes.ts, so neither path can quietly narrow what counts. The
//     cues below are written out LITERALLY in this file — never read back from the
//     module under test — so this cannot degrade into `expect(x).toContain(x)`.
//  2. A MODEL'S SYNONYM does not cost a segment its findings. `parseDeepResponse`
//     rejects the whole reply on an off-vocabulary `category`, which is right for
//     garbage and was catastrophic for "word choice": every finding in that segment
//     was discarded, and the class most exposed was vocabulary.
//  3. EVERY CLASS SURVIVES THE WHOLE PATH — model reply → parse → cascade → persist
//     (past the SQL CHECK) → the canonical read model → every surface. A class
//     dropped by a schema CHECK, a category filter, or a view is a failing test.
//     The two deliberate ROUTING exclusions (a pronunciation finding has no
//     answerable card; only a pronunciation finding gets a studio drill) are asserted
//     in BOTH directions, so widening or narrowing either one shows up here.
//
// Prompt content is the honest limit for anything a model must obey: no key is used
// and no model is called anywhere in this file, so §1 proves what we SEND, never what
// the model does with it. §2 and §3 are fully behavioural.
// ─────────────────────────────────────────────────────────────────────────────

const TEMPO = 1.5;
const dirs: string[] = [];

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-coverage-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

// ---- 1. one shared definition of what counts as a mistake -------------------

describe("one definition of a mistake, shared by the tutor and the recording path", () => {
  const persona = () =>
    buildTutorPersona({ register: "colto", targetLanguage: "Italian", nativeLanguage: "English" });

  // Written out here, not imported: if lib/mistakes.ts loses a class, this list still
  // says what the product promised and the test goes red.
  const CLASS_CUES = [
    "GRAMMAR",
    "VOCABULARY AND WORD CHOICE",
    "PRONUNCIATION",
    "No class outranks another",
    // grammar, beyond the -o/-a example that used to be the whole mandate
    "Agreement of gender and number",
    "penso che sia vero",
    "se avessi tempo, verrei",
    '"ho andato" — "sono andato"',
    '"il studente" — "lo studente"',
    '"lo telefono" — "gli telefono"',
    // vocabulary — the class the tutor never named before E-39
    "the grammar is intact but the word is wrong",
    "attualmente",
    "eventualmente",
    '"fare una decisione" — "prendere una decisione"',
    "sostenere un esame",
    '"la problema" — "il problema"',
    // pronunciation
    "geminates",
    "voiced against voiceless s and z",
    "misplaced stress",
  ];

  const PRECISION_CUES = [
    "Never invent an error",
    "If you did not clearly hear it, do not flag it",
    "regional or otherwise acceptable variant",
    "A false correction is worse than a missed one",
    "must never infer it from their voice",
    "Flag what you actually heard, never what their L1 predicts",
  ];

  it("the tutor persona carries every class and every precision clause", () => {
    const p = persona();
    for (const cue of [...CLASS_CUES, ...PRECISION_CUES]) expect(p).toContain(cue);
  });

  it("the deep-listen prompt carries the SAME classes and the same precision clauses", () => {
    const prompt = deepPrompt("Italian");
    for (const cue of [...CLASS_CUES, ...PRECISION_CUES]) expect(prompt).toContain(cue);
  });

  it("the deep prompt maps each class onto the five stored category words", () => {
    const prompt = deepPrompt("Italian");
    // Vocabulary is the one that had no definition at all: a bare label in a list.
    expect(prompt).toContain('"vocabulary" for a wrong word');
    expect(prompt).toContain("a false friend, a calqued word, a wrong collocation");
    expect(prompt).toContain('"grammar" for a wrong form');
    expect(prompt).toContain('"pronunciation" for a wrong sound');
    for (const c of CATEGORIES) expect(prompt).toContain(c);
  });

  it("neither path ranks the -o/-a example above whole classes (the E-39 regression)", () => {
    for (const text of [persona(), deepPrompt("Italian")]) {
      expect(text).not.toMatch(/highest priority/i);
      expect(text).not.toMatch(/priority order/i);
      // …while the example itself is still there, inside the agreement bullet.
      expect(text).toContain('"la ragazzo" (it\'s "il ragazzo")');
    }
  });
});

// ---- 2. a synonym must not cost a segment its findings ---------------------

describe("normalizeCategory — a recognisable label lands, an unrecognisable one still fails", () => {
  const aliases: [string, Category][] = [
    ["word choice", "vocabulary"],
    ["word_choice", "vocabulary"],
    ["Word Choice", "vocabulary"],
    ["lexis", "vocabulary"],
    ["vocab", "vocabulary"],
    ["Grammar", "grammar"],
    ["syntax", "grammar"],
    ["agreement", "grammar"],
    ["pronounciation", "pronunciation"],
    ["phonology", "pronunciation"],
    ["idiomatic", "idiom"],
    ["wording", "phrasing"],
    ["  grammar  ", "grammar"],
  ];
  it.each(aliases)("%s → %s", (raw, expected) => {
    expect(normalizeCategory(raw)).toBe(expected);
  });

  it("returns null — never a guess — for anything it does not recognise", () => {
    for (const raw of ["", "vibes", "usage", "fluency", "42", null, undefined, {}]) {
      expect(normalizeCategory(raw)).toBeNull();
    }
  });

  // [E-42 criterion 14] `register` moved from the refused list to the accepted one,
  // and this test moved with it. It was the ONE label the prompt actively invited —
  // `lib/mistakes.ts` class B names a register slip as a mistake and
  // ENRICHED_NOTES_INSTRUCTION puts the word "register" in front of the model — while
  // the parser rejected it, and the cost of rejection was not one lost finding but
  // the WHOLE segment. A class the model is asked to produce and the schema silently
  // discards is exactly the defect PR #66 existed to remove.
  it("accepts `register`, the one label the prompt invites, as the word-choice class", () => {
    expect(normalizeCategory("register")).toBe("vocabulary");
    expect(normalizeCategory("Register")).toBe("vocabulary");
  });

  it("one synonym no longer discards the OTHER findings in the same reply", () => {
    // The fixture: three real mistakes the model heard correctly, one of them labelled
    // with the English name for the class. Before E-39 this reply parsed to nothing and
    // the segment was recorded unreadable.
    const reply = JSON.stringify({
      findings: [
        { quote: "penso che è vero", correction: "penso che sia vero", category: "grammar", explanation: "congiuntivo", severity: "high", relStartMs: 0, relEndMs: 100 },
        { quote: "attualmente sono stanco", correction: "in realtà sono stanco", category: "word choice", explanation: "false friend", severity: "medium", relStartMs: 100, relEndMs: 200 },
        { quote: "ho fatto una decisione", correction: "ho preso una decisione", category: "Vocabulary", explanation: "collocation", severity: "low", relStartMs: 200, relEndMs: 300 },
      ],
    });
    const parsed = parseDeepResponse(reply);
    expect(parsed.findings).toHaveLength(3);
    expect(parsed.findings.map((f) => f.category)).toEqual(["grammar", "vocabulary", "vocabulary"]);
    expect(parsed.findings[1].correction).toBe("in realtà sono stanco");
  });

  it("an unreadable category is still a truthful whole-reply parse error", () => {
    const reply = JSON.stringify({
      findings: [
        { quote: "a", correction: "b", category: "grammar", explanation: "e", severity: "high" },
        { quote: "c", correction: "d", category: "vibes", explanation: "e", severity: "high" },
      ],
    });
    expect(() => parseDeepResponse(reply)).toThrow(ModelParseError);
  });
});

// ---- 3. every class survives the whole path --------------------------------

/** The model's raw reply for one finding of `category` — the fixture, in the shape the
 *  API actually returns, so the parser is exercised rather than bypassed. */
function rawReply(category: Category): string {
  return JSON.stringify({
    findings: [
      {
        quote: `sbaglio di ${category}`,
        correction: `corretto ${category}`,
        category,
        explanation: `why ${category} is wrong`,
        severity: "high",
        relStartMs: 100,
        relEndMs: 400,
      },
    ],
    produced: [],
  });
}

/** A one-segment session with dummy audio on disk for both cascade renditions. */
function seedSession(db: Db, id: string): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 120 });
  const hash = `${id}-h0`;
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: 60_000, contentHash: hash });
  for (const p of [renditionCachePath(hash, TEMPO), segmentPath(id, 0)]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
  }
}

/** A mock model that returns the FIXTURE STRING through the real parser. */
function clientReturning(raw: string): AudioModelClient {
  return {
    async triage() {
      return { flagged: true };
    },
    async deepListen() {
      return parseDeepResponse(raw);
    },
  };
}

describe("every class of mistake survives prompt → parse → persist → surface", () => {
  // Which categories may become a card / a studio drill. Stated here as the expected
  // routing, so a change to either exclusion set fails this test instead of silently
  // removing a class from a feature: a pronunciation finding has no answerable card
  // front (E-37/RETRO-003), and the studio is for pronunciation.
  const CARDABLE: Category[] = ["grammar", "vocabulary", "phrasing", "idiom"];
  const DRILLABLE: Category[] = ["pronunciation"];

  it.each([...CATEGORIES])("a %s finding reaches every surface it should", async (category) => {
    const db = freshDb();
    seedSession(db, "s1");
    const job = await runAnalysisJob(db, enqueueAnalysis(db, "s1").id, clientReturning(rawReply(category)), {
      tempo: TEMPO,
    });
    expect(job.state).toBe("done");

    const quote = `sbaglio di ${category}`;
    const correction = `corretto ${category}`;

    // Persisted past the SQL CHECK, with the class intact.
    const session = listSessionFindings(db, "s1");
    expect(session).toHaveLength(1);
    expect(session[0].category).toBe(category);
    expect(session[0].quote).toBe(quote);
    // Timeline offsets came from the reply's clip-relative ms, not from zero.
    expect(session[0].startMs).toBe(100);

    // The canonical read model (E-17) — every surface's single gate.
    expect(listIncludedFindings(db).map((f) => f.quote)).toContain(quote);
    expect(listIncludedFindingsWithSession(db).map((f) => f.quote)).toContain(quote);
    expect(findingTallies(db)).toEqual([
      { sessionId: "s1", category, severity: "high", count: 1 },
    ]);

    // The session report's per-category row: this class counts 1, and the row still
    // sums to the number of findings (an unmapped class would break the sum).
    const counts = categoryCounts(session);
    expect(counts.find((c) => c.category === category)?.count).toBe(1);
    expect(counts.reduce((n, c) => n + c.count, 0)).toBe(session.length);

    // Phrasebook, Archive.
    expect(buildPhrasebook(listIncludedFindings(db), new Set()).map((e) => e.correction)).toContain(correction);
    expect(buildArchive(listIncludedFindingsWithSession(db)).map((e) => e.correction)).toContain(correction);

    // Focus: the class is counted, not just totalled.
    const focus = buildFocusModel(db);
    expect(focus.totalFindings).toBe(1);
    expect(focus.categories.find((c) => c.category === category)?.count).toBe(1);

    // Slips: the recurring-mistake cluster keeps the class.
    materializeSlips(db);
    expect(listSlips(db).map((s) => s.category)).toContain(category);

    // Shadow: every class is shadowable.
    expect(listShadowDrills(db).map((d) => d.findingId)).toContain(session[0].id);

    // Cards and studio drills — the two deliberate routing exclusions, both directions.
    generateCards(db);
    const carded = listCards(db).some((c) => c.findingId === session[0].id);
    expect(carded).toBe(CARDABLE.includes(category));
    const drilled = listPronunciationDrills(db).some((d) => d.findingId === session[0].id);
    expect(drilled).toBe(DRILLABLE.includes(category));

    db.close();
  });

  it("the enriched notes the deep pass is paid for reach the report, all three fields", async () => {
    const db = freshDb();
    seedSession(db, "s2");
    // The fixture asks for all three E-28 fields on one grammar finding.
    const raw = JSON.stringify({
      findings: [
        {
          quote: "una problema",
          correction: "un problema",
          category: "grammar",
          explanation: "gender",
          severity: "medium",
          relStartMs: 0,
          relEndMs: 500,
          notes: {
            pronunciation: "geminate in 'problema' clipped",
            register: "una questione delicata",
            disfluency: "false start before 'una'",
          },
        },
      ],
      produced: [],
    });
    await runAnalysisJob(db, enqueueAnalysis(db, "s2").id, clientReturning(raw), { tempo: TEMPO });

    const [f] = listSessionFindings(db, "s2");
    expect(f.notes?.pronunciation).toBe("geminate in 'problema' clipped");
    expect(f.notes?.register).toBe("una questione delicata");
    expect(f.notes?.disfluency).toBe("false start before 'una'");
    // The pronunciation note is the one that also ROUTES: it puts a non-pronunciation
    // finding into the studio (lib/pronunciation/drills.ts).
    expect(listPronunciationDrills(db).map((d) => d.suspect)).toContain("geminate in 'problema' clipped");
    db.close();
  });
});
