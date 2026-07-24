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

// E-36 criteria 4/5/6: produced-lemma POSITIVE evidence is gated by the speaker
// verdict (a non-user segment mints none; a null/unattributed segment behaves exactly
// as before attribution existed), by a session-level "not me" exclusion, and is
// IDEMPOTENT (a replayed deep-listen appends no duplicate). Findings are unaffected.
// Uses a mock AudioModelClient (no network, no ffmpeg) on the full-deep path.

const dirs: string[] = [];
function ws(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-gate-"));
  dirs.push(dir);
  process.env.ERIKA_DATA_DIR = dir;
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  delete process.env.ERIKA_DATA_DIR;
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Seed a session (short ⇒ full-deep, no triage) with one 60 s segment per hash. */
function seed(db: Db, sessionId: string, hashes: string[]): void {
  createSession(db, { id: sessionId, originalFilename: "t.wav", format: "wav", sizeBytes: 1, durationSeconds: 120 });
  hashes.forEach((hash, idx) => {
    upsertSegment(db, { sessionId, idx, startMs: idx * 60_000, endMs: idx * 60_000 + 60_000, contentHash: hash });
    const p = segmentPath(sessionId, idx);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, Buffer.from(`audio-${hash}`));
  });
}

/** A mock deep model: every flagged/deep segment reports one finding + `casa`/NOUN
 *  produced correctly (morph-it-attested, so it is a real positive). */
function mockClient(): AudioModelClient {
  return {
    async triage() {
      return { flagged: true };
    },
    async deepListen() {
      return {
        findings: [
          { quote: "q", correction: "c", category: "grammar", explanation: "why", severity: "low", startMs: 0, endMs: 0, relStartMs: 0, relEndMs: 1 },
        ],
        produced: [{ lemma: "casa", pos: "NOUN" }],
      };
    },
  };
}

const producedCount = (db: Db) =>
  (db.prepare("SELECT COUNT(*) AS n FROM evidence WHERE source='finding' AND mode='spontaneous' AND polarity=1").get() as { n: number }).n;
const findingCount = (db: Db) => (db.prepare("SELECT COUNT(*) AS n FROM findings").get() as { n: number }).n;

async function run(db: Db, sessionId: string): Promise<void> {
  await runAnalysisJob(db, enqueueAnalysis(db, sessionId).id, mockClient(), { tempo: 1.5 });
}

describe("E-36 — produced-lemma evidence is gated by the speaker verdict", () => {
  it("mints positives for a user segment but ZERO for a non-user one — findings unaffected", async () => {
    const db = ws();
    seed(db, "s", ["userhash", "otherhash"]);
    const segs = listSegments(db, "s");
    setSegmentAttribution(db, segs[0].id, 0.95, 1); // the enrolled user
    setSegmentAttribution(db, segs[1].id, 0.30, 0); // a bystander
    await run(db, "s");

    // One produced positive (the user segment only); the non-user segment minted none.
    expect(producedCount(db)).toBe(1);
    // But BOTH segments still produced their finding — only the positive credit is gated.
    expect(findingCount(db)).toBe(2);
    db.close();
  });

  it("with NO attribution (null verdict) behaviour is identical to today — nothing suppressed", async () => {
    const db = ws();
    seed(db, "s", ["h1", "h2"]);
    // Leave is_user null on both (no enrollment / filter off).
    await run(db, "s");
    expect(producedCount(db)).toBe(2); // both segments mint their positive, as before E-36
    db.close();
  });

  it("an EXCLUDED session mints zero positives regardless of the acoustic verdict", async () => {
    const db = ws();
    seed(db, "s", ["h1", "h2"]);
    const segs = listSegments(db, "s");
    setSegmentAttribution(db, segs[0].id, 0.99, 1); // attributed to the user…
    setSegmentAttribution(db, segs[1].id, 0.99, 1);
    setSessionExcluded(db, "s", true); // …but the whole session is "not me"
    await run(db, "s");
    expect(producedCount(db)).toBe(0);
    db.close();
  });

  it("is idempotent — replaying a segment's deep-listen appends no duplicate positive", async () => {
    const db = ws();
    seed(db, "s", ["h1"]);
    await run(db, "s");
    expect(producedCount(db)).toBe(1);

    // Force a REPLAY: drop the never-re-bill witness so the next run deep-listens the
    // same segment again and re-emits the same produced lemma. Before the idempotency
    // key this appended a second identical row; now INSERT OR IGNORE makes it a no-op.
    db.prepare("DELETE FROM segment_analyses WHERE content_hash = 'h1'").run();
    await run(db, "s");
    expect(producedCount(db)).toBe(1); // still one — the replay was deduped
    db.close();
  });
});
