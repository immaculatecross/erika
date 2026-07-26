import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { parseSpokenPlacement } from "@/lib/onboarding/spoken-parse";
import { resolveLevel } from "@/lib/onboarding/spoken";
import { levelLine } from "@/lib/placement/result-copy";
import { ModelParseError } from "@/lib/analysis/model-errors";
import { BANDS, type Band, type PlacementAnswer } from "@/lib/placement/scoring";
import type { Db } from "@/lib/db";

// E-46 criteria 3, 10, 11 — the spoken sample, and exactly what it does.
//
// Criterion 10 asks for a plain statement of what the spoken sample CHANGES, and
// warns that an assessment step costing ninety seconds and changing nothing is a
// worse defect than not having one. So the change is asserted here rather than
// described: the placed level, the seeded grammar, and the sentence the learner
// reads all move — and in exactly one direction.

describe("parsing what the model says about a spoken sample", () => {
  it("reads a committed band", () => {
    expect(parseSpokenPlacement('{"level":"B2","usable":true}')).toEqual({ band: "B2", usable: true });
  });

  it("accepts a band in either field name and any case", () => {
    expect(parseSpokenPlacement('{"band":"c1","usable":true}')).toEqual({ band: "C1", usable: true });
  });

  it("finds the object inside surrounding prose", () => {
    expect(parseSpokenPlacement('Sure! {"level":"A2","usable":true} Hope that helps.')).toEqual({
      band: "A2",
      usable: true,
    });
  });

  it("refuses a usable verdict that names no band — that is a contradiction, not data", () => {
    expect(parseSpokenPlacement('{"level":null,"usable":true}')).toEqual({ band: null, usable: false });
  });

  it("degrades an unknown band to no band rather than guessing", () => {
    expect(parseSpokenPlacement('{"level":"fluent","usable":true}')).toEqual({ band: null, usable: false });
  });

  it("treats an unusable verdict as unusable even when a band came with it", () => {
    expect(parseSpokenPlacement('{"level":"C2","usable":false}')).toEqual({ band: "C2", usable: false });
  });

  it("throws on the PROSE reply a live call actually produces", () => {
    // Measured, not imagined. `gpt-audio-mini` on a clip it cannot judge answers in
    // prose — "I could not hear any speech" — rather than with the JSON object it was
    // asked for. That is what sends the call into the repo's one-shot strict-JSON
    // repair, and it is why `placementListen` takes `CallOpts` at all.
    expect(() => parseSpokenPlacement("I'm sorry, I could not hear any speech in that audio.")).toThrow(
      ModelParseError,
    );
  });

  it("throws a ModelParseError on a reply that is not JSON at all", () => {
    // The reply resolved and BILLED, so the caller must finalize the charge — that is
    // the contract `reservedCall` keys on. A silent default here would be a free lunch
    // the ledger does not have.
    expect(() => parseSpokenPlacement("I could not hear anything.")).toThrow(ModelParseError);
    expect(() => parseSpokenPlacement('{"level": }')).toThrow(ModelParseError);
  });
});

describe("combining the two measurements — the spoken sample only ever raises", () => {
  const measured = (level: Band | null) => ({ level, caveat: null });

  it("keeps the check's level when the speech agrees or reads lower", () => {
    expect(resolveLevel(measured("B2"), "B2")).toEqual({ level: "B2", source: "check" });
    expect(resolveLevel(measured("B2"), "A1")).toEqual({ level: "B2", source: "check" });
    expect(resolveLevel(measured("C1"), null)).toEqual({ level: "C1", source: "check" });
  });

  it("takes the spoken band when it reads higher", () => {
    expect(resolveLevel(measured("A2"), "B1")).toEqual({ level: "B1", source: "spoken" });
    expect(resolveLevel(measured(null), "B1")).toEqual({ level: "B1", source: "spoken" });
  });

  it("gives the yes-biased learner the escape the check refuses them", () => {
    // A `response-style` run is refused as unmeasurable. Until now the ONLY route out
    // was taking the same check again (RETRO-004 §1, the last open item).
    const refused = { level: "C2" as Band | null, caveat: "response-style" as const };
    expect(resolveLevel(refused, "B2")).toEqual({ level: "B2", source: "spoken" });
  });

  it("lets an invalidated check contribute NOTHING — not even a floor", () => {
    // The refusal's whole point: a response style is not a measurement, so it may not
    // become one by being combined with something real. Its own C2 claim is discarded
    // even though it is higher than the spoken B1.
    const refused = { level: "C2" as Band | null, caveat: "response-style" as const };
    expect(resolveLevel(refused, "B1")).toEqual({ level: "B1", source: "spoken" });
    expect(resolveLevel(refused, null)).toEqual({ level: null, source: "none" });
  });

  it("survives every band pairing without inventing a level", () => {
    for (const a of BANDS) {
      for (const b of BANDS) {
        const r = resolveLevel(measured(a), b);
        expect(BANDS).toContain(r.level);
      }
    }
  });
});

describe("the sentence the rescued learner reads", () => {
  it("credits the speech and does not blame the answers for a level they did not set", () => {
    const line = levelLine({
      level: "B2",
      levelSource: "spoken",
      calibrated: false,
      caveat: "response-style",
      seededWords: 0,
      seededRules: 120,
      supersededItems: 0,
    });
    expect(line).toContain("could not be measured");
    expect(line).toContain("speaking sample placed you around B2");
    expect(line).toContain("120 grammar points below it are marked seen");
    expect(line).toContain("The words you marked are not counted.");
    // The plain sentence would have said this, and it would have been false.
    expect(line).not.toContain("This is a rough placement.");
  });

  it("says plainly when the speech beat a measured check", () => {
    const line = levelLine({
      level: "B2",
      levelSource: "spoken",
      calibrated: true,
      caveat: null,
      seededWords: 0,
      seededRules: 120,
      supersededItems: 0,
    });
    expect(line).toContain("Placed around B2.");
    expect(line).toContain("higher than the word check did");
  });

  it("is unchanged for a run with no spoken sample", () => {
    const line = levelLine({
      level: "B1",
      calibrated: true,
      caveat: null,
      seededWords: 4,
      seededRules: 60,
      supersededItems: 0,
    });
    expect(line).toBe("Placed around B1. 4 words you knew are now in your model. 60 grammar points below it are marked seen.");
  });
});

// ---------------------------------------------------------------------------
// The write path: what the rescue actually puts in the database.

let root: string;
let db: Db;
let PLACEMENT_POST: typeof import("@/app/api/placement/route").POST;

beforeAll(async () => {
  root = tmpDir("erika-spoken-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  PLACEMENT_POST = (await import("@/app/api/placement/route")).POST;
  db = (await import("@/lib/db")).getDb();
});

const PER_BAND = 8;

/** The yes-biased learner: everything marked known, invented words included. */
function yesToEverything(): PlacementAnswer[] {
  const ids = (
    db.prepare("SELECT id FROM knowledge_items WHERE kind='lemma' ORDER BY freq_rank LIMIT 48").all() as {
      id: string;
    }[]
  ).map((r) => r.id);
  const answers: PlacementAnswer[] = [];
  BANDS.forEach((b, i) => {
    for (let j = 0; j < PER_BAND; j++) {
      answers.push({ kind: "real", band: b, itemId: ids[i * PER_BAND + j], known: true });
    }
  });
  for (let i = 0; i < 16; i++) answers.push({ kind: "pseudo", known: true });
  return answers;
}

async function place(body: Record<string, unknown>) {
  const res = await PLACEMENT_POST(
    new Request("http://t/api/placement", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return (await res.json()) as {
    level: Band | null;
    levelSource: string;
    caveat: string | null;
    runId: string | null;
    seededWords: number;
    seededRules: number;
  };
}

describe("a refused check with a spoken band seeds the level and NOT the words", () => {
  it("writes nothing at all without the speech, and grammar-only with it", async () => {
    const answers = yesToEverything();

    const alone = await place({ answers });
    expect(alone.caveat).toBe("response-style");
    expect(alone.runId).toBeNull(); // unchanged: an unmeasurable run is a non-event
    expect(alone.seededWords).toBe(0);
    expect(alone.seededRules).toBe(0);

    const rescued = await place({ answers, spokenBand: "B1" });
    expect(rescued.level).toBe("B1");
    expect(rescued.levelSource).toBe("spoken");
    expect(rescued.runId).not.toBeNull();
    expect(rescued.seededRules).toBeGreaterThan(0);
    // The yeses on real words are still worthless — they came from the same response
    // style the scorer refused. Only the LEVEL survived, from a different instrument.
    expect(rescued.seededWords).toBe(0);
    const seededVocab = db
      .prepare(
        "SELECT COUNT(*) AS n FROM evidence e JOIN knowledge_items i ON i.id = e.item_id WHERE e.source='placement' AND i.kind='lemma'",
      )
      .get() as { n: number };
    expect(seededVocab.n).toBe(0);
  });

  it("still refuses an unmeasurable run that brings no spoken band", async () => {
    const res = await place({ answers: yesToEverything(), spokenBand: null });
    expect(res.runId).toBeNull();
    expect(res.level).toBeNull();
  });
});
