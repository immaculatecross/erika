import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import {
  UnvalidatedLemmaError,
  bridgeFinding,
  deriveStatus,
  ensureLemmaItem,
  evidenceToGrade,
  getItem,
  itemEvidence,
  lemmaItemId,
  parseItemId,
  recordEvidence,
  rebuildAllDerived,
  MODE_WEIGHT,
} from "@/lib/knowledge";

// The knowledge core (E-25, D-19): items + the append-only evidence log + the
// derived, rebuildable state. A real SQLite file per test, torn down after.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-knowledge-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed one included finding (a complete analysis witness) and return its id. */
let seq = 0;
function seedIncludedFinding(db: Db, sessionId: string): string {
  createSession(db, { id: sessionId, originalFilename: `${sessionId}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 60 });
  const hash = `${sessionId}-h${seq++}`;
  persistSegmentFindings(db, {
    sessionId,
    contentHash: hash,
    flagged: true,
    deepDone: true,
    findings: [{ quote: "vado a casa", correction: "vado a casa", category: "vocabulary", explanation: "why", severity: "low", startMs: 0, endMs: 1 }],
  });
  return (db.prepare("SELECT id FROM findings WHERE content_hash = ?").get(hash) as { id: string }).id;
}

describe("knowledge items — the morph-it gate (criterion 2)", () => {
  it("mints a lemma item only for an attested (lemma, POS), idempotently", () => {
    const db = freshDb();
    const id = ensureLemmaItem(db, "casa", "NOUN");
    expect(id).toBe("lemma:casa#NOUN");
    expect(ensureLemmaItem(db, "casa", "NOUN")).toBe(id); // idempotent
    // Exactly one row for this id (idempotent) — knowledge_items also carries the
    // v17-seeded lexicon, so scope the count to the id under test.
    expect((db.prepare("SELECT COUNT(*) AS n FROM knowledge_items WHERE id = ?").get(id) as { n: number }).n).toBe(1);
    const item = getItem(db, id)!;
    expect(item.kind).toBe("lemma");
    expect(item.lemma).toBe("casa");
    expect(item.pos).toBe("NOUN");
    expect(item.status).toBe("unseen"); // no evidence yet
  });

  it("refuses to mint an unvalidated lemma item", () => {
    const db = freshDb();
    expect(() => ensureLemmaItem(db, "zzzfoo", "NOUN")).toThrow(UnvalidatedLemmaError);
    expect(() => ensureLemmaItem(db, "casa", "VERB")).toThrow(UnvalidatedLemmaError); // wrong POS
    // Neither rejected lemma was minted (the seed never carries them either).
    expect(db.prepare("SELECT 1 FROM knowledge_items WHERE id = 'lemma:zzzfoo#NOUN'").get()).toBeUndefined();
    expect(db.prepare("SELECT 1 FROM knowledge_items WHERE id = 'lemma:casa#VERB'").get()).toBeUndefined();
  });

  it("the evidence write path also refuses an unvalidated lemma id", () => {
    const db = freshDb();
    // A fabricated lemma id whose item was never (and could never be) created.
    expect(() =>
      recordEvidence(db, {
        itemId: lemmaItemId("zzzfoo", "NOUN"),
        source: "exercise",
        polarity: 1,
        mode: "cued",
        audioDerived: false,
      }),
    ).toThrow(UnvalidatedLemmaError);
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(0);
  });

  it("parseItemId round-trips a lemma id (with and without a forced sense)", () => {
    expect(parseItemId("lemma:pesca#NOUN")).toEqual({ kind: "lemma", lemma: "pesca", pos: "NOUN", senseKey: null });
    expect(parseItemId("lemma:pesca#NOUN#2")).toEqual({ kind: "lemma", lemma: "pesca", pos: "NOUN", senseKey: "2" });
    expect(parseItemId("rule:congiuntivo").kind).toBe("rule");
    expect(parseItemId("phone:/ʎ/").kind).toBe("phone");
  });
});

describe("evidence is append-only (criterion 1)", () => {
  it("the table rejects UPDATE and DELETE at the SQL level", () => {
    const db = freshDb();
    ensureLemmaItem(db, "cane", "NOUN");
    const ev = recordEvidence(db, { itemId: "lemma:cane#NOUN", source: "exercise", polarity: 1, mode: "cued", audioDerived: false });
    expect(() => db.prepare("UPDATE evidence SET polarity = 0 WHERE id = ?").run(ev.id)).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM evidence WHERE id = ?").run(ev.id)).toThrow(/append-only/);
    expect((db.prepare("SELECT COUNT(*) AS n FROM evidence").get() as { n: number }).n).toBe(1);
  });
});

describe("findings → evidence bridge, through the E-17 scope (criterion 4)", () => {
  it("writes a correctly-weighted, correctly-mapped evidence row for an included finding", () => {
    const db = freshDb();
    const fid = seedIncludedFinding(db, "s1");
    ensureLemmaItem(db, "casa", "NOUN");

    // A spontaneous error in a recording: audio-derived, so weight = 1.0 × 0.7.
    const ev = bridgeFinding(db, fid, { itemId: "lemma:casa#NOUN", polarity: 0, mode: "spontaneous" });
    expect(ev.source).toBe("finding");
    expect(ev.sourceRef).toBe(fid);
    expect(ev.sessionId).toBe("s1");
    expect(ev.weight).toBeCloseTo(MODE_WEIGHT.spontaneous * 0.7, 6); // 0.7
    expect(evidenceToGrade(ev.polarity, ev.mode)).toBe("again"); // incorrect → Again

    // A cued correct recording finding: 0.6 × 0.7 = 0.42, mapped to Good.
    const ev2 = bridgeFinding(db, fid, { itemId: "lemma:casa#NOUN", polarity: 1, mode: "cued" });
    expect(ev2.weight).toBeCloseTo(0.42, 6);
    expect(evidenceToGrade(ev2.polarity, ev2.mode)).toBe("good");
  });

  it("maps every evidence grade the spike-2 way", () => {
    expect(evidenceToGrade(0, "spontaneous")).toBe("again");
    expect(evidenceToGrade(0, "cued")).toBe("again");
    expect(evidenceToGrade(1, "cued")).toBe("good");
    expect(evidenceToGrade(1, "spontaneous")).toBe("easy");
    // Recognition is too weak to be an FSRS review — status only.
    expect(evidenceToGrade(1, "recognition")).toBeNull();
    expect(evidenceToGrade(0, "recognition")).toBeNull();
  });

  it("refuses a finding outside the included-finding scope (no competing gate)", () => {
    const db = freshDb();
    createSession(db, { id: "s2", originalFilename: "s2.wav", format: "wav", sizeBytes: 1, durationSeconds: 60 });
    // flagged but deep NOT done → incomplete witness → not an included finding.
    persistSegmentFindings(db, {
      sessionId: "s2",
      contentHash: "s2-incomplete",
      flagged: true,
      deepDone: false,
      findings: [{ quote: "q", correction: "c", category: "grammar", explanation: "e", severity: "low", startMs: 0, endMs: 1 }],
    });
    const fid = (db.prepare("SELECT id FROM findings WHERE content_hash = 's2-incomplete'").get() as { id: string }).id;
    ensureLemmaItem(db, "casa", "NOUN");
    expect(() => bridgeFinding(db, fid, { itemId: "lemma:casa#NOUN", polarity: 0, mode: "spontaneous" })).toThrow(/E-17/);
  });

  it("recognition evidence moves status but never the FSRS triple", () => {
    const db = freshDb();
    ensureLemmaItem(db, "gatto", "NOUN");
    recordEvidence(db, { itemId: "lemma:gatto#NOUN", source: "placement", polarity: 1, mode: "recognition", audioDerived: false });
    const item = getItem(db, "lemma:gatto#NOUN")!;
    expect(item.status).toBe("introduced");
    expect(item.srsStability).toBeNull(); // no FSRS review happened
    expect(item.srsDifficulty).toBeNull();
    expect(item.srsLastEventAt).toBeNull();
  });
});

describe("'known' needs corroboration (criterion 5, D-19)", () => {
  const item = "lemma:parola#NOUN";
  function ev(db: Db, over: { polarity: 0 | 1; mode: "spontaneous" | "cued" | "recognition"; audio: boolean; day: string }) {
    recordEvidence(db, {
      itemId: item,
      source: over.audio ? "finding" : "exercise",
      polarity: over.polarity,
      mode: over.mode,
      audioDerived: over.audio,
      createdAt: `${over.day} 12:00:00`,
    });
  }

  it("does NOT reach 'known' on audio-only positives, however many", () => {
    const db = freshDb();
    ensureLemmaItem(db, "parola", "NOUN");
    ev(db, { polarity: 1, mode: "spontaneous", audio: true, day: "2026-01-01" });
    ev(db, { polarity: 1, mode: "spontaneous", audio: true, day: "2026-01-02" });
    expect(getItem(db, item)!.status).not.toBe("known"); // one noisy audio-positive can't flip it
  });

  it("does NOT reach 'known' on a single correct event", () => {
    const db = freshDb();
    ensureLemmaItem(db, "parola", "NOUN");
    ev(db, { polarity: 1, mode: "spontaneous", audio: false, day: "2026-01-01" });
    expect(getItem(db, item)!.status).not.toBe("known");
  });

  it("reaches 'known' with 2 correct on 2 days, ≥1 spontaneous, a non-audio one, none incorrect since", () => {
    const db = freshDb();
    ensureLemmaItem(db, "parola", "NOUN");
    ev(db, { polarity: 1, mode: "spontaneous", audio: true, day: "2026-01-01" }); // spontaneous (audio)
    ev(db, { polarity: 1, mode: "cued", audio: false, day: "2026-01-02" }); // non-audio corroboration
    expect(getItem(db, item)!.status).toBe("known");
  });

  it("an incorrect after corroboration drops it out of 'known' (→ lapsed)", () => {
    const db = freshDb();
    ensureLemmaItem(db, "parola", "NOUN");
    ev(db, { polarity: 1, mode: "spontaneous", audio: false, day: "2026-01-01" });
    ev(db, { polarity: 1, mode: "cued", audio: false, day: "2026-01-02" });
    expect(getItem(db, item)!.status).toBe("known");
    ev(db, { polarity: 0, mode: "spontaneous", audio: true, day: "2026-01-03" });
    expect(getItem(db, item)!.status).toBe("lapsed"); // a slip since the last correct
  });

  it("deriveStatus is a pure function of the event list", () => {
    // unseen with no evidence; introduced with only recognition.
    expect(deriveStatus([])).toBe("unseen");
  });
});

describe("derived state rebuilds identically from evidence alone (criterion 6)", () => {
  it("wiping and rebuilding the cache reproduces it exactly", () => {
    const db = freshDb();
    ensureLemmaItem(db, "casa", "NOUN");
    ensureLemmaItem(db, "mangiare", "VERB");
    ensureLemmaItem(db, "bello", "ADJ");

    // A varied evidence history across items, modes, days and polarities.
    recordEvidence(db, { itemId: "lemma:casa#NOUN", source: "exercise", polarity: 1, mode: "spontaneous", audioDerived: false, createdAt: "2026-02-01 09:00:00" });
    recordEvidence(db, { itemId: "lemma:casa#NOUN", source: "finding", polarity: 1, mode: "cued", audioDerived: true, createdAt: "2026-02-03 09:00:00" });
    recordEvidence(db, { itemId: "lemma:mangiare#VERB", source: "finding", polarity: 0, mode: "spontaneous", audioDerived: true, createdAt: "2026-02-02 09:00:00" });
    recordEvidence(db, { itemId: "lemma:mangiare#VERB", source: "exercise", polarity: 1, mode: "cued", audioDerived: false, createdAt: "2026-02-05 09:00:00" });
    recordEvidence(db, { itemId: "lemma:bello#ADJ", source: "placement", polarity: 1, mode: "recognition", audioDerived: false, createdAt: "2026-02-01 09:00:00" });

    const columns = "id, srs_stability, srs_difficulty, srs_last_event_at, status";
    const before = db.prepare(`SELECT ${columns} FROM knowledge_items ORDER BY id`).all();

    // Wipe every derived column — evidence (the source of truth) is untouched.
    db.prepare("UPDATE knowledge_items SET srs_stability = NULL, srs_difficulty = NULL, srs_last_event_at = NULL, status = 'unseen'").run();
    const wiped = db.prepare(`SELECT ${columns} FROM knowledge_items ORDER BY id`).all();
    expect(wiped).not.toEqual(before); // the wipe really changed the cache

    const rebuilt = rebuildAllDerived(db);
    // Rebuilds every item — the three under test plus the v17-seeded lexicon rows
    // (which carry no evidence, so they rebuild to unseen exactly as they began).
    expect(rebuilt).toBe(before.length);
    const after = db.prepare(`SELECT ${columns} FROM knowledge_items ORDER BY id`).all();
    expect(after).toEqual(before); // rebuilt from evidence alone, identical
  });

  it("itemEvidence returns the log in the canonical fold order", () => {
    const db = freshDb();
    ensureLemmaItem(db, "cane", "NOUN");
    recordEvidence(db, { itemId: "lemma:cane#NOUN", source: "exercise", polarity: 1, mode: "cued", audioDerived: false, createdAt: "2026-03-02 10:00:00" });
    recordEvidence(db, { itemId: "lemma:cane#NOUN", source: "exercise", polarity: 0, mode: "cued", audioDerived: false, createdAt: "2026-03-01 10:00:00" });
    const log = itemEvidence(db, "lemma:cane#NOUN");
    expect(log.map((e) => e.createdAt)).toEqual(["2026-03-01 10:00:00", "2026-03-02 10:00:00"]);
  });
});
