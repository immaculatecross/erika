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

/** A short session (⇒ full-deep, no triage) with one 60 s segment per hash.
 *
 *  [E-39 §B2] The session carries a real `captured_at` — what the in-app recorder sends,
 *  and what this surface's every claim is now derived from. It is deliberately NOT the
 *  upload instant `created_at`: these tests used to simulate capture time by writing that
 *  column, which is exactly the confusion the fix removes. Cases below override it to put
 *  the capture in the past while the analysis still runs "now". */
function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, {
    id: sessionId,
    originalFilename: "t.wav",
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 120,
    capturedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
  });
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
    recordEvidence(db, { itemId: ITEM, source: "exercise", polarity: 1, mode: "cued", audioDerived: false });
    recordEvidence(db, { itemId: ITEM, source: "placement", polarity: 1, mode: "recognition", audioDerived: false });
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

  // ── [review F1] the beat is about WHEN THEY SPOKE, not when we noticed ─────────

  it("keys the day on the SESSION'S CAPTURE TIME, not the evidence mint time", async () => {
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    // Capture on Tuesday morning; the deep pass runs now (Friday evening, whenever
    // "now" is) — Erika's normal day-scale async case: dump today, Analyze later.
    db.prepare("UPDATE sessions SET captured_at = '2026-07-21 05:00:00' WHERE id = 's'").run();
    await analyse(db, "s");
    // Sanity: the two instants really do differ, so this test can fail.
    const mintDay = localDay(
      new Date(
        Date.parse(
          (db.prepare("SELECT created_at AS c FROM evidence LIMIT 1").get() as { c: string }).c.replace(" ", "T") +
            "Z",
        ),
      ),
    );
    expect(mintDay).not.toBe("2026-07-21");

    // The beat belongs to the day they SPOKE…
    const spoken = buildTodayThread(db, "2026-07-21", [ITEM]);
    expect(spoken).not.toBeNull();
    // …and NOT to the day we happened to analyse it.
    expect(buildTodayThread(db, mintDay, [ITEM])).toBeNull();
    db.close();
  });

  it("says the part of day they SPOKE, not the part of day we analysed", async () => {
    const tzBefore = process.env.TZ;
    process.env.TZ = "Europe/Rome"; // 05:00Z ⇒ 07:00 local, unambiguously morning
    try {
      const db = ws();
      seed(db, "s", ["userhash"]);
      setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
      db.prepare("UPDATE sessions SET captured_at = '2026-07-21 05:00:00' WHERE id = 's'").run();
      await analyse(db, "s");
      expect(buildTodayThread(db, "2026-07-21", [ITEM])!.partOfDay).toBe("this morning");
      db.close();
    } finally {
      if (tzBefore === undefined) delete process.env.TZ;
      else process.env.TZ = tzBefore;
    }
  });

  it("adds the segment's offset, so a 24-hour dump bins correctly WITHIN itself", async () => {
    const tzBefore = process.env.TZ;
    process.env.TZ = "Europe/Rome";
    try {
      const db = ws();
      // One session captured at 07:00 local; the segment carrying the lemma sits
      // 13 hours into the recording — i.e. the learner said it at 20:00, that evening.
      seed(db, "s", ["userhash"]);
      const seg = listSegments(db, "s")[0];
      setSegmentAttribution(db, seg.id, 0.95, 1);
      db.prepare("UPDATE sessions SET captured_at = '2026-07-21 05:00:00' WHERE id = 's'").run();
      await analyse(db, "s");
      db.prepare("UPDATE segments SET start_ms = ? WHERE id = ?").run(13 * 3_600_000, seg.id);
      expect(buildTodayThread(db, "2026-07-21", [ITEM])!.partOfDay).toBe("this evening");

      // Push the offset past local midnight: the speech now belongs to the NEXT day.
      db.prepare("UPDATE segments SET start_ms = ? WHERE id = ?").run(20 * 3_600_000, seg.id);
      expect(buildTodayThread(db, "2026-07-21", [ITEM])).toBeNull();
      expect(buildTodayThread(db, "2026-07-22", [ITEM])).not.toBeNull();
      db.close();
    } finally {
      if (tzBefore === undefined) delete process.env.TZ;
      else process.env.TZ = tzBefore;
    }
  });

  it("does not cite a session whose capture time sorts outside the day (SQL prefilter)", async () => {
    // [review nit 3] Named for what it actually proves: 'not-a-date' sorts ABOVE the
    // upper bound as text, so the row never leaves SQL. That is a real path, but it is
    // the prefilter — the isNaN guard is exercised by the next case.
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    await analyse(db, "s");
    const day = localDay();
    expect(buildTodayThread(db, day, [ITEM])).not.toBeNull();
    db.prepare("UPDATE sessions SET captured_at = 'not-a-date' WHERE id = 's'").run();
    expect(buildTodayThread(db, day, [ITEM])).toBeNull();
    db.close();
  });

  it("does not cite a capture time that PASSES the prefilter but will not parse", async () => {
    // [review nit 3] The isNaN guard, exercised for real: this timestamp sorts inside
    // the day's text range (it starts with the right date) yet Date.parse gives NaN,
    // so only the per-row guard can reject it. Unverifiable ⇒ not a claim we make.
    const db = ws();
    seed(db, "s", ["userhash"]);
    setSegmentAttribution(db, listSegments(db, "s")[0].id, 0.95, 1);
    await analyse(db, "s");
    const day = localDay();
    expect(buildTodayThread(db, day, [ITEM])).not.toBeNull();

    const bogus = `${day} 25:99:99`; // in text range, impossible clock time
    db.prepare("UPDATE sessions SET captured_at = ? WHERE id = 's'").run(bogus);
    // Prove the premise: SQL really does hand this row through.
    const survived = db
      .prepare("SELECT COUNT(*) AS n FROM sessions WHERE captured_at >= ? AND captured_at < ?")
      .get(`${day} 00:00:00`, `${day} 99:99:99`) as { n: number };
    expect(survived.n).toBe(1);
    expect(Number.isNaN(Date.parse(bogus.replace(" ", "T") + "Z"))).toBe(true);

    expect(buildTodayThread(db, day, [ITEM])).toBeNull();
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
      audioDerived: true,
    });
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    db.close();
  });

  it("does not cite a positive whose provenance cannot be resolved to a segment", () => {
    const db = ws();
    ensureLemmaItem(db, "casa", "NOUN");
    // A legacy pre-E-36 produced positive: no source_ref, so whose voice it was is
    // unknowable. Also a row whose segment/session is simply gone.
    recordEvidence(db, { itemId: ITEM, source: "finding", polarity: 1, mode: "spontaneous", audioDerived: true });
    recordEvidence(db, {
      itemId: ITEM,
      source: "finding",
      sourceRef: "ghost:hash:casa#NOUN",
      sessionId: "ghost",
      polarity: 1,
      mode: "spontaneous",
      audioDerived: true,
    });
    expect(buildTodayThread(db, localDay(), [ITEM])).toBeNull();
    db.close();
  });

  it("cites a repeated hash when its occurrences AGREE, and not when they disagree", async () => {
    // [review nit 4] One content hash can appear twice in a session, and the evidence
    // row names the hash, not the occurrence — so which one they said it in is unknown.
    const tzBefore = process.env.TZ;
    process.env.TZ = "Europe/Rome";
    try {
      const db = ws();
      seed(db, "s", ["userhash"]);
      const seg = listSegments(db, "s")[0];
      setSegmentAttribution(db, seg.id, 0.95, 1);
      db.prepare("UPDATE sessions SET captured_at = '2026-07-21 05:00:00' WHERE id = 's'").run();
      await analyse(db, "s");

      // A second occurrence of the SAME audio, 1 h later — still the morning. Agreeing
      // occurrences say the same thing, so the beat is safe to make.
      db.prepare(
        `INSERT INTO segments (id, session_id, idx, start_ms, end_ms, duration_ms, content_hash, is_user)
         VALUES ('dup', 's', 9, ?, ?, 60000, 'userhash', 1)`,
      ).run(3_600_000, 3_660_000);
      expect(buildTodayThread(db, "2026-07-21", [ITEM])!.partOfDay).toBe("this morning");

      // Move the duplicate to the evening: the two occurrences now disagree about what
      // the sentence would claim, so we say nothing rather than pick one.
      db.prepare("UPDATE segments SET start_ms = ? WHERE id = 'dup'").run(14 * 3_600_000);
      expect(buildTodayThread(db, "2026-07-21", [ITEM])).toBeNull();
      db.close();
    } finally {
      if (tzBefore === undefined) delete process.env.TZ;
      else process.env.TZ = tzBefore;
    }
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
