import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { readYield, bumpYield } from "@/lib/knowledge/yield";
import { buildKnowledgeInspection } from "@/lib/knowledge/inspector";
import { recordProducedLemmas } from "@/lib/analysis/produced-lemmas";

// [RETRO-002 T2] Knowledge-core yield instrumentation: cumulative emitted/attested/
// dropped counters and the dev inspector's read model.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-yield-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("yield counters", () => {
  it("accumulate durably and start at zero", () => {
    const db = freshDb();
    expect(readYield(db)).toEqual({ emitted: 0, attested: 0, dropped: 0 });
    bumpYield(db, { emitted: 5, attested: 3, dropped: 2 });
    bumpYield(db, { emitted: 1, attested: 1, dropped: 0 });
    expect(readYield(db)).toEqual({ emitted: 6, attested: 4, dropped: 2 });
    db.close();
  });

  it("recordProducedLemmas records emitted/attested/dropped for a mixed batch", () => {
    const db = freshDb();
    createSession(db);
    // 'casa'/NOUN and 'bello'/ADJ are attested by morph-it; 'zzzfoo' is not.
    const written = recordProducedLemmas(db, "s1", "hash-yield", [
      { lemma: "casa", pos: "NOUN" },
      { lemma: "bello", pos: "ADJ" },
      { lemma: "zzzfoo", pos: "NOUN" },
    ]);
    expect(written).toBe(2);
    expect(readYield(db)).toEqual({ emitted: 3, attested: 2, dropped: 1 });
    db.close();
  });
});

describe("knowledge inspection read model", () => {
  it("reports the composer pools and yield the composer depends on", () => {
    const db = freshDb();
    const insp = buildKnowledgeInspection(db);
    // The seeded lexicon/syllabus give the composer a real pool to draw from.
    expect(insp.composerPool.unseenVocab).toBeGreaterThan(1000);
    expect(insp.composerPool.unseenRules).toBeGreaterThanOrEqual(250);
    expect(insp.yield).toEqual({ emitted: 0, attested: 0, dropped: 0 });
    db.close();
  });
});

function createSession(db: Db): void {
  db.prepare(
    "INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds) VALUES ('s1','t.wav','wav',1,60)",
  ).run();
}
