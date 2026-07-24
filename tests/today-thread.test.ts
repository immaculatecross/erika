import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession, setSessionExcluded } from "@/lib/sessions";
import { upsertSegment, listSegments } from "@/lib/segments";
import { segmentPath } from "@/lib/audio-storage";
import { setSegmentAttribution } from "@/lib/speaker";
import { enqueueAnalysis, runAnalysisJob } from "@/lib/analysis/cascade";
import type { AudioModelClient } from "@/lib/analysis/audio-model";
import { recordEvidence } from "@/lib/knowledge/evidence";
import { ensureLemmaItem } from "@/lib/knowledge/items";
import { buildTodayThread, contentHashOfSourceRef } from "@/lib/today-thread";
import { threadSentence } from "@/components/today-thread";
import { localDay } from "@/lib/local-day";
import { buildToday } from "@/lib/today";

// E-38 criterion 4 (RETRO-003, D-19). "Today's thread" cites what the learner
// ACTUALLY SAID, or it says nothing. The four negatives are the point of this file:
// a bystander-attributed segment, an excluded session, a cued-only event, and no
// qualifying evidence must each yield NO beat — never a softened or generic one.
//
// The positive path mints evidence through the REAL cascade with a mock audio model
// (the produced-lemma-gate precedent), so the row under test is a genuine
// spontaneous produced-lemma positive, not a hand-written imitation of one.

const ITEM = "lemma:casa#NOUN"; // what the mock model reports the learner produced
const dirs: string[] = [];

function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-thread-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A short session (⇒ full-deep, no triage) with one 60 s segment per hash. */
function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 120 });
  hashes.forEach((hash, idx) => {
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    const p = segmentPath(sessionId, idx);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
  });
}

/** Every deep segment reports one finding plus `casa`/NOUN produced correctly. */
function mockClient(): AudioModelClient {
  return {
    async triage() {
      return { flagged: true };
    },
    async deepListen() {
      return {
        findings: [
          {
            quote: "q",
            correction: "c",
            category: "grammar",
            explanation: "why",
            severity: "low",
            startMs: 0,
            endMs: 0,
            relStartMs: 0,
            relEndMs: 1,
          },
        ],
        produced: [{ lemma: "casa", pos: "NOUN" }],
      };
    },
  };
}

async function analyse(db: Db, sessionId: string): Promise<void> {
  await runAnalysisJob(db, enqueueAnalysis(db, sessionId).id, mockClient(), { tempo: 1.5 });
}

const producedCount = (db: Db) =>
  (
    db
      .prepare("SELECT COUNT(*) AS n FROM evidence WHERE source='finding' AND mode='spontaneous' AND polarity=1")
      .get() as { n: number }
  ).n;

describe("today's thread — the beat exists only when it is TRUE", () => {
  it("cites a genuine spontaneous production of a target from the learner's own speech", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1); // the enrolled user
    await analyse(db, "s");
    expect(producedCount(db)).toBe(1);

    const thread = buildTodayThread(db, localDay(), [ITEM]);
    expect(thread).not.toBeNull();
    expect(thread!.itemId).toBe(ITEM);
    expect(thread!.label).toBe("casa");
    expect(threadSentence(thread!)).toMatch(
      /^Today's plan included casa — and you used it in this (morning|afternoon|evening)'s recording\.$/,
    );
    db.close();
  });

  it("treats an UNATTRIBUTED segment as the user (E-36 recall-first, D-22)", async () => {
    const db = ws();
    seed(db, "s", ["nullhash"]); // is_user stays NULL — no enrollment / filter off
    await analyse(db, "s");
    expect(buildTodayThread(db, localDay(), [ITEM])).not.toBeNull();
    db.close();
  });

  // ── the four negatives ────────────────────────────────────────────────────────

  it("NEGATIVE 1 — a bystander-attributed segment yields no beat", async () => {
    const db = ws();
    seed(db, "s", ["otherhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.3, 0); // somebody else
    await analyse(db, "s");
    expect(producedCount(db)).toBe(0); // E-36 gates it at write time…
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();

    // …and the READ re-applies the gate, so a verdict that flips to non-user after
    // the fact (a re-enrollment recomputes verdicts) also un-cites the row.
    const db2 = ws();
    seed(db2, "s2", ["userhash"]);
    const seg = listSegments(db2, "s2")[0];
    setSegmentAttribution(db2, seg.id, 0.95, 1);
    await analyse(db2, "s2");
    expect(buildTodayThread(db2, localDay(), [ITEM])).not.toBeNull();
    setSegmentAttribution(db2, seg.id, 0.3, 0); // re-attributed to a bystander
    expect(buildTodayThread(db2, localDay(), [ITEM])).toBeNull();
    db.close();
    db2.close();
  });

  it("NEGATIVE 2 — an excluded session ('not me') yields no beat, even retroactively", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.99, 1);
    await analyse(db, "s");
    expect(buildTodayThread(db, localDay(), [ITEM])).not.toBeNull();

    // The toggle can be flipped AFTER the evidence was minted; the beat must follow.
    setSessionExcluded(db, "s", true);
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    setSessionExcluded(db, "s", false);
    expect(buildTodayThread(db, localDay(), [ITEM])).not.toBeNull();
    db.close();
  });

  it("NEGATIVE 3 — a CUED (or recognition) event is never 'you used it'", () => {
    const db = ws();
    ensureLemmaItem(db, "casa", "NOUN");
    // A correct exercise answer and a placement recognition seed, both today.
    recordEvidence(db, { itemId: ITEM, source: "exercise", polarity: 1, mode: "cued" });
    recordEvidence(db, { itemId: ITEM, source: "placement", polarity: 1, mode: "recognition" });
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    db.close();
  });

  it("NEGATIVE 4 — no qualifying evidence yields no beat (and no consolation copy)", () => {
    const db = ws();
    ensureLemmaItem(db, "casa", "NOUN");
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    expect(buildTodayThread(db, localDay(), [])).toBeNull(); // no targets either
    db.close();
  });

  // ── further honesty edges ─────────────────────────────────────────────────────

  it("does not cite a production of something that was NOT on today's plan", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    await analyse(db, "s");
    expect(buildTodayThread(db, localDay(), ["lemma:tempo#NOUN"])).toBeNull();
    db.close();
  });

  it("does not cite a production from a DIFFERENT local day", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    await analyse(db, "s");
    expect(buildTodayThread(db, "2026-01-01", [ITEM])).toBeNull();
    db.close();
  });

  it("does not cite a NEGATIVE production event as a success", () => {
    const db = ws();
    ensureLemmaItem(db, "casa", "NOUN");
    recordEvidence(db, {
      itemId: ITEM,
      source: "finding",
      sourceRef: "sX:hX:casa#NOUN",
      polarity: 0,
      mode: "spontaneous",
    });
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    db.close();
  });

  it("does not cite a positive whose provenance cannot be resolved to a segment", () => {
    const db = ws();
    ensureLemmaItem(db, "casa", "NOUN");
    // A legacy pre-E-36 produced positive: no source_ref, so whose voice it was is
    // unknowable. Also a row whose segment/session is simply gone.
    recordEvidence(db, { itemId: ITEM, source: "finding", polarity: 1, mode: "spontaneous" });
    recordEvidence(db, {
      itemId: ITEM,
      source: "finding",
      sourceRef: "ghost:hash:casa#NOUN",
      sessionId: "ghost",
      polarity: 1,
      mode: "spontaneous",
    });
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    db.close();
  });

  it("parses the segment content hash out of a produced source_ref", () => {
    expect(contentHashOfSourceRef("sess-1:abc123:casa#NOUN")).toBe("abc123");
    expect(contentHashOfSourceRef("nope")).toBeNull();
  });
});

describe("buildToday wires the beat to the composer's real targets", () => {
  it("surfaces the thread for a due review card linked to the produced item", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    await analyse(db, "s");

    // A due, previously-graded card linked to the item ⇒ compose() lists it as a
    // review, so `lemma:casa#NOUN` is genuinely one of today's targets.
    const findingId = (db.prepare("SELECT id FROM findings LIMIT 1").get() as { id: string }).id;
    db.prepare(
      `INSERT INTO cards (id, finding_id, session_id, item_id, front, back, category, start_ms,
                          ease, interval_days, repetitions, due, last_grade, suspended)
       VALUES ('c1', ?, 's', ?, 'fr', 'bk', 'grammar', 0, 2.5, 2, 1, datetime('now','-1 day'), 'good', 0)`,
    ).run(findingId, ITEM);

    const view = buildToday(db, localDay());
    expect(view.thread).not.toBeNull();
    expect(view.thread!.itemId).toBe(ITEM);
    db.close();
  });

  it("has a null thread on a fresh database — nothing is manufactured", () => {
    const db = ws();
    const view = buildToday(db, localDay());
    expect(view.thread).toBeNull();
    db.close();
  });
});
