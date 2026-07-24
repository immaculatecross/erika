import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  parseLogEvidenceArgs,
  logTutorEvidence,
  InvalidEvidenceCallError,
} from "@/lib/tutor/log-evidence";
import { ensureRuleItem, getItem } from "@/lib/knowledge/items";

// The `log_evidence` → evidence bridge (E-34, WO criterion 3). Simulated tool calls
// land append-only evidence rows on VALIDATED ids; invalid ids are rejected, never
// minted; derived knowledge state rebuilds. An error and a success both log (D-18
// lives in the persona/composer, not here).

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-ev-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("parseLogEvidenceArgs", () => {
  it("accepts a well-formed call and normalizes polarity/mode", () => {
    const call = parseLogEvidenceArgs({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "spontaneous" });
    expect(call).toEqual({ itemId: "lemma:casa#NOUN", polarity: 1, mode: "spontaneous", sessionId: null });
    expect(parseLogEvidenceArgs({ itemId: "rule:articoli", polarity: "incorrect", mode: "cued" }).polarity).toBe(0);
  });

  it("rejects malformed calls", () => {
    expect(() => parseLogEvidenceArgs(null)).toThrow(InvalidEvidenceCallError);
    expect(() => parseLogEvidenceArgs({ polarity: "correct", mode: "cued" })).toThrow(InvalidEvidenceCallError);
    expect(() => parseLogEvidenceArgs({ itemId: "phone:r", polarity: "correct", mode: "cued" })).toThrow(
      InvalidEvidenceCallError,
    );
    expect(() => parseLogEvidenceArgs({ itemId: "lemma:casa#NOUN", polarity: "maybe", mode: "cued" })).toThrow(
      InvalidEvidenceCallError,
    );
    expect(() => parseLogEvidenceArgs({ itemId: "lemma:casa#NOUN", polarity: "correct", mode: "guess" })).toThrow(
      InvalidEvidenceCallError,
    );
  });
});

describe("logTutorEvidence writes on validated ids and rebuilds derived state", () => {
  it("writes a success on an attested lemma and moves the item off 'unseen'", () => {
    const db = freshDb();
    const ev = logTutorEvidence(db, { itemId: "lemma:casa#NOUN", polarity: 1, mode: "spontaneous" });
    expect(ev.source).toBe("tutor");
    expect(ev.polarity).toBe(1);
    // Tutor evidence is NOT audio-derived — a spontaneous positive carries the full 1.0 weight.
    expect(ev.weight).toBeCloseTo(1.0);
    const item = getItem(db, "lemma:casa#NOUN");
    expect(item).not.toBeNull();
    expect(item!.status).not.toBe("unseen");
    db.close();
  });

  it("writes an error on a seeded rule (an error is logged, never minted as a drill)", () => {
    const db = freshDb();
    ensureRuleItem(db, "articoli");
    const ev = logTutorEvidence(db, { itemId: "rule:articoli", polarity: 0, mode: "cued" });
    expect(ev.itemId).toBe("rule:articoli");
    expect(ev.polarity).toBe(0);
    expect(ev.mode).toBe("cued");
    db.close();
  });

  it("REJECTS an unattested lemma id and never mints it", () => {
    const db = freshDb();
    expect(() => logTutorEvidence(db, { itemId: "lemma:zzzfoo#NOUN", polarity: 1, mode: "spontaneous" })).toThrow(
      InvalidEvidenceCallError,
    );
    expect(db.prepare("SELECT 1 FROM knowledge_items WHERE id = 'lemma:zzzfoo#NOUN'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) AS n FROM evidence").get()).toEqual({ n: 0 });
    db.close();
  });

  it("REJECTS an unknown rule id (not a seeded syllabus rule)", () => {
    const db = freshDb();
    expect(() =>
      logTutorEvidence(db, { itemId: "rule:__not_a_real_rule__", polarity: 1, mode: "cued" }),
    ).toThrow(InvalidEvidenceCallError);
    expect(db.prepare("SELECT COUNT(*) AS n FROM evidence").get()).toEqual({ n: 0 });
    db.close();
  });
});
