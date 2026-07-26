import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { kindLine, levelLine, weekLine, fossilLine } from "@/lib/progress-copy";
import type { Db } from "@/lib/db";

// E-46 criteria 6 and 7 — "what Erika knows about you", and every number on it
// honest.
//
// Two things are proved here, and the second is the one this repo keeps failing:
//
//  1. The figures come from the knowledge core and from `computeSlipStandings`, the
//     SAME standing Focus reduces, so the product keeps one notion of mastery.
//  2. GREEN STAYS MASTERY. D-24's load case — heavy activity, nothing resolved, still
//     neutral — is proved against `computeSlipStandings` in tests/knowledge-map.test.ts
//     and is NOT re-stated here in a weaker form. What is asserted instead is the thing
//     this milestone could break: that the progress surface reduces that one shared
//     standing rather than growing a second opinion of its own.
//
// And the empty state is asserted as COPY, not as a zero. The v0.6 review lenses
// singled this repo's empty states out as genuinely good; "not started" is the
// difference between "we have not measured this" and "we measured zero".

let root: string;
let db: Db;
let buildProgress: typeof import("@/lib/progress").buildProgress;
let openDatabase: typeof import("@/lib/db").openDatabase;
let recordEvidence: typeof import("@/lib/knowledge/evidence").recordEvidence;

beforeAll(async () => {
  root = tmpDir("erika-progress-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  buildProgress = (await import("@/lib/progress")).buildProgress;
  openDatabase = (await import("@/lib/db")).openDatabase;
  recordEvidence = (await import("@/lib/knowledge/evidence")).recordEvidence;
  db = (await import("@/lib/db")).getDb();
});

function freshDb(name: string): Db {
  return openDatabase(path.join(root, `${name}.db`));
}

const DAY = "2026-07-26";

describe("a learner Erika has never observed", () => {
  it("says 'not started' rather than rendering zeroes as measurements", () => {
    const d = freshDb("cold");
    const v = buildProgress(d, DAY);
    expect(v.hasEvidence).toBe(false);
    for (const k of v.kinds) {
      expect(k.known).toBe(0);
      expect(kindLine(k)).toBe("Not started");
    }
    expect(levelLine(v)).toBe("No level has been estimated yet.");
    expect(weekLine(v.movedCount)).toBe("Nothing has moved in the last seven days.");
    expect(fossilLine(v)).toBe("No recurring mistakes have been found yet.");
  });

  it("claims no return and no trend anywhere in its copy", () => {
    // "N sounds at your edge… they come back through the lines below" promised a
    // return no code path implements (RETRO-004 §1). Nothing on this surface may.
    const d = freshDb("cold2");
    const v = buildProgress(d, DAY);
    const sentences = [levelLine(v), weekLine(v.movedCount), fossilLine(v), ...v.kinds.map(kindLine)];
    for (const s of sentences) {
      expect(s).not.toMatch(/come back|on track|keep it up|improv|trend|streak/i);
    }
  });
});

describe("what moved this week", () => {
  it("counts real evidence and excludes a placement's guesses", () => {
    const d = freshDb("moved");
    const lemmas = (
      d.prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT 3").all() as {
        id: string;
      }[]
    ).map((r) => r.id);

    // A placement seeds recognition for hundreds of items. That is a starting
    // position, not a week's work, and folding it into "this week" would be the most
    // flattering lie this screen could tell.
    for (const id of lemmas) {
      recordEvidence(d, {
        itemId: id,
        source: "placement",
        sourceRef: "placement:run-1",
        polarity: 1,
        mode: "recognition",
        audioDerived: false,
      });
    }
    expect(buildProgress(d, DAY).movedCount).toBe(0);

    // One real production event does move.
    recordEvidence(d, {
      itemId: lemmas[0],
      source: "exercise",
      sourceRef: "ex-1",
      polarity: 1,
      mode: "cued",
      audioDerived: false,
    });
    const v = buildProgress(d, DAY);
    expect(v.movedCount).toBe(1);
    expect(v.moved[0].itemId).toBe(lemmas[0]);
    expect(v.moved[0].label).not.toBe(lemmas[0]); // a lemma, not a raw item id
    expect(weekLine(v.movedCount)).toBe("1 thing moved in the last seven days.");
  });
});

describe("green stays mastery — the progress surface reduces the SHARED standing", () => {
  it("renders exactly buildKnowledgeMap, so there is one notion of mastery", async () => {
    // The map is not recomputed here and must never be: `computeSlipStandings` is the
    // same standing Focus reduces, and D-24's load case ("heavy activity, nothing
    // resolved, still neutral") is proved against it in tests/knowledge-map.test.ts.
    // What this asserts is the thing that could regress in THIS milestone — that the
    // progress surface reads that one source rather than growing a second opinion.
    const { buildKnowledgeMap } = await import("@/lib/knowledge-map");
    const d = freshDb("map");
    expect(buildProgress(d, DAY).map).toEqual(buildKnowledgeMap(d));
  });

  it("never carries a green band for a category with nothing resolved", () => {
    const d = freshDb("map2");
    for (const cell of buildProgress(d, DAY).map) {
      if (cell.resolved === 0) expect(cell.band).toBe(0);
    }
  });

  it("distinguishes 'nothing stuck' from 'nothing observed'", () => {
    const clean = freshDb("clean");
    expect(fossilLine(buildProgress(clean, DAY))).toBe("No recurring mistakes have been found yet.");
  });
});

describe("the level line is honest about confidence", () => {
  it("hedges an uncalibrated placement and does not hedge a calibrated one", () => {
    expect(levelLine({ level: "B1", levelCalibrated: true })).toBe("Placed around B1.");
    expect(levelLine({ level: "B1", levelCalibrated: false })).toContain("a rough estimate");
    expect(levelLine({ level: null, levelCalibrated: false })).toBe("No level has been estimated yet.");
  });
});

describe("kindLine", () => {
  it("never renders a bare zero next to real numbers", () => {
    expect(kindLine({ kind: "lemma", known: 0, inProgress: 0, lapsed: 0 })).toBe("Not started");
    expect(kindLine({ kind: "lemma", known: 12, inProgress: 0, lapsed: 0 })).toBe("nothing else yet");
    expect(kindLine({ kind: "lemma", known: 12, inProgress: 4, lapsed: 0 })).toBe("4 in progress");
    expect(kindLine({ kind: "lemma", known: 12, inProgress: 4, lapsed: 2 })).toBe("4 in progress · 2 slipped");
    // Observed but nothing known yet is still "started" — it is a real measurement.
    expect(kindLine({ kind: "rule", known: 0, inProgress: 9, lapsed: 0 })).toBe("9 in progress");
  });
});
