import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession, setSessionExcluded } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category, type NewFinding } from "@/lib/analysis/findings";
import {
  findingTallies,
  getIncludedFinding,
  listAnalysedSessions,
  listIncludedFindings,
  listIncludedFindingsWithSession,
  listSessionFindings,
} from "@/lib/findings-model";
import { buildEntries as buildPhrasebook } from "@/lib/phrasebook";
import { buildEntries as buildArchive } from "@/lib/archive";
import { derivePatterns } from "@/lib/lessons/patterns";
import { generateCards, listCards, pinFinding } from "@/lib/cards";
import { compose, capsFromSettings } from "@/lib/compose";
import { listPronunciationDrills } from "@/lib/pronunciation/drills";
import { listSlips, materializeSlips } from "@/lib/slips";
import { buildFocusModel } from "@/lib/focus";
import {
  learnerSegmentSql,
  learnerSpeechSql,
  learnerSpoke,
  learnerSpokeAnyOf,
} from "@/lib/speaker/own-speech";

// E-39 §B1 — a bystander's errors must not become the learner's.
//
// E-36 gated POSITIVE evidence on `segments.is_user` and left the findings scope with no
// speaker predicate at all, so another person's mistakes flowed into the learner's
// Phrasebook, Archive, report, Focus rates, patterns, cards, slips, drills and daily
// plan. The invariant now lives in one place (`lib/speaker/own-speech.ts`) and is read by
// the one findings gate (`lib/findings-model.ts`).
//
// EVERY expectation here comes from the FIXTURE — the seed says which segment is whose —
// and the assertions are written positively wherever a positive is available: the
// learner's own findings must be PRESENT with the exact ids seeded for them, not merely
// "the bystander's is absent". The opposite failure (a fix that drops the learner's own
// findings) is therefore what most of this file guards, because that is the failure v0.6
// kept shipping.

const HOUR = 3_600_000;
const DAY = "2026-07-13";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-speaker-scope-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

function finding(tag: string, category: Category = "grammar"): NewFinding {
  return {
    quote: `quote-${tag}`,
    correction: `correction-${tag}`,
    category,
    explanation: "why",
    severity: "high",
    startMs: 1000,
    endMs: 1500,
  };
}

/**
 * One session, one segment per speaker slot, one finding on each — the whole fixture.
 * `speakers` is the ground truth: the index is the segment, the value its `is_user`
 * verdict (1 the learner, 0 somebody else, null unattributed). Returns the finding id
 * per slot so every assertion below names the exact row the fixture created.
 */
function seed(
  db: Db,
  sessionId: string,
  speakers: readonly (0 | 1 | null)[],
  category: Category = "grammar",
): string[] {
  createSession(db, {
    id: sessionId,
    originalFilename: `${sessionId}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 3600,
  });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${DAY} 09:00:00`, sessionId);
  db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES (?, ?, 'done')").run(
    `job-${sessionId}`,
    sessionId,
  );

  const ids: string[] = [];
  speakers.forEach((isUser, i) => {
    const hash = `${sessionId}-h${i}`;
    const seg = upsertSegment(db, {
      sessionId,
      idx: i,
      startMs: i * HOUR,
      endMs: i * HOUR + 60_000,
      contentHash: hash,
    });
    db.prepare("UPDATE segments SET is_user = ? WHERE id = ?").run(isUser, seg.id);
    persistSegmentFindings(db, {
      sessionId,
      contentHash: hash,
      flagged: true,
      deepDone: true,
      findings: [finding(`${sessionId}-${i}`, category)],
    });
    const row = db
      .prepare("SELECT id FROM findings WHERE session_id = ? AND content_hash = ?")
      .get(sessionId, hash) as { id: string };
    ids.push(row.id);
  });
  return ids;
}

describe("the findings scope counts only the learner's own speech (E-39 §B1)", () => {
  it("keeps EVERY finding for an un-enrolled learner — no verdict means the learner (D-22)", () => {
    const db = freshDb();
    const ids = seed(db, "s-unattributed", [null, null, null]);

    // The fixture said all three are the learner's. All three must be present, by id.
    expect(listIncludedFindings(db).map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(listSessionFindings(db, "s-unattributed").map((f) => f.id).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(getIncludedFinding(db, id)?.id).toBe(id);
    expect(findingTallies(db).reduce((n, t) => n + t.count, 0)).toBe(3);
  });

  it("keeps EVERY finding the verifier positively attributed to the learner", () => {
    const db = freshDb();
    const ids = seed(db, "s-learner", [1, 1]);
    expect(listIncludedFindings(db).map((f) => f.id).sort()).toEqual([...ids].sort());
    expect(findingTallies(db).reduce((n, t) => n + t.count, 0)).toBe(2);
  });

  it("drops ONLY the segment attributed to somebody else, on every surface at once", () => {
    const db = freshDb();
    // Ground truth: slots 0 and 2 are the learner (one attributed, one unattributed),
    // slot 1 is another person in the room.
    const [mine, theirs, alsoMine] = seed(db, "s-mixed", [1, 0, null]);
    const expected = [mine, alsoMine].sort();

    // The model itself
    expect(listIncludedFindings(db).map((f) => f.id).sort()).toEqual(expected);
    expect(listIncludedFindingsWithSession(db).map((f) => f.id).sort()).toEqual(expected);
    expect(listSessionFindings(db, "s-mixed").map((f) => f.id).sort()).toEqual(expected);
    expect(getIncludedFinding(db, mine)?.id).toBe(mine);
    expect(getIncludedFinding(db, alsoMine)?.id).toBe(alsoMine);
    expect(getIncludedFinding(db, theirs)).toBeNull();
    expect(findingTallies(db).reduce((n, t) => n + t.count, 0)).toBe(2);

    // The Phrasebook and the Archive, through their own composition paths
    expect(buildPhrasebook(listIncludedFindings(db), new Set()).map((e) => e.findingId).sort()).toEqual(
      expected,
    );
    expect(
      buildArchive(listIncludedFindingsWithSession(db))
        .map((e) => e.findingId)
        .sort(),
    ).toEqual(expected);

    // Lesson patterns are built over the learner's findings only. Two of the three
    // grammar findings are hers, which is below the recurrence threshold — so the
    // bystander's third must not be what tips a pattern into existence.
    expect(derivePatterns(listIncludedFindings(db))).toEqual([]);

    // Card generation, and the deliberate single-finding pin (E-39 §B6)
    generateCards(db);
    expect(listCards(db).map((c) => c.findingId).sort()).toEqual(expected);
    expect(pinFinding(db, theirs)).toEqual({ status: "not_found" });
    expect(pinFinding(db, mine).status).toBe("pinned");

    // The daily plan's unspent findings
    const planned = new Set(
      compose(db, DAY, capsFromSettings(db))
        .items.filter((i) => i.kind === "finding")
        .map((i) => i.ref),
    );
    expect(planned.has(mine) || planned.has(alsoMine)).toBe(true);
    expect(planned.has(theirs)).toBe(false);
  });

  it("keeps the bystander's speech out of the rate DENOMINATOR too", () => {
    const db = freshDb();
    // Three analysed one-minute segments; one of them is somebody else's.
    seed(db, "s-denominator", [1, 0, null]);
    const [row] = listAnalysedSessions(db);
    // The fixture wrote 60 000 ms per segment and two of the three are the learner's.
    expect(row.analysedSpeechMs).toBe(120_000);
    // Numerator and denominator agree: two findings over two minutes.
    const focus = buildFocusModel(db);
    expect(focus.totalFindings).toBe(2);
    expect(focus.speechHours).toBeCloseTo(120_000 / 3_600_000, 10);
  });

  it("never drops a pronunciation drill or a slip that IS the learner's", () => {
    const db = freshDb();
    const [mine, theirs] = seed(db, "s-drills", [null, 0], "pronunciation");
    const drills = listPronunciationDrills(db);
    expect(drills.map((d) => d.findingId)).toEqual([mine]);
    expect(drills.map((d) => d.findingId)).not.toContain(theirs);
  });

  it("honours the learner's own 'this recording isn't me', and gives it all back", () => {
    const db = freshDb();
    const mineIds = seed(db, "s-mine", [null]);
    const theirIds = seed(db, "s-podcast", [null]);

    // Before: both sessions' findings are the learner's (nothing is attributed away).
    expect(listIncludedFindings(db).map((f) => f.id).sort()).toEqual([...mineIds, ...theirIds].sort());

    // The learner says the second recording is not them.
    expect(setSessionExcluded(db, "s-podcast", true)).toBe(true);
    expect(listIncludedFindings(db).map((f) => f.id)).toEqual(mineIds);
    expect(listSessionFindings(db, "s-podcast")).toEqual([]);
    expect(getIncludedFinding(db, theirIds[0])).toBeNull();

    // Reversible — the scope re-reads the switch, so nothing is lost, only hidden.
    expect(setSessionExcluded(db, "s-podcast", false)).toBe(true);
    expect(listIncludedFindings(db).map((f) => f.id).sort()).toEqual([...mineIds, ...theirIds].sort());
  });

  it("takes the verdict over every copy of repeated audio in the session", () => {
    const db = freshDb();
    // Same audio twice in one session with contradicting verdicts: attribution was
    // re-run under a different enrollment. Any `0` means "attributed to somebody
    // else", the reading lib/today-thread.ts already shipped.
    createSession(db, {
      id: "s-repeat",
      originalFilename: "s-repeat.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
    });
    db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES ('j-r', 's-repeat', 'done')").run();
    for (const [idx, isUser] of [[0, 1], [1, 0]] as const) {
      const seg = upsertSegment(db, {
        sessionId: "s-repeat",
        idx,
        startMs: idx * 1000,
        endMs: idx * 1000 + 500,
        contentHash: "shared-hash",
      });
      db.prepare("UPDATE segments SET is_user = ? WHERE id = ?").run(isUser, seg.id);
    }
    persistSegmentFindings(db, {
      sessionId: "s-repeat",
      contentHash: "shared-hash",
      flagged: true,
      deepDone: true,
      findings: [finding("repeat")],
    });
    expect(listIncludedFindings(db)).toEqual([]);
  });

  it("materializes no slip from a bystander's repeated mistake", () => {
    const db = freshDb();
    // The same correction three times — enough to be a recurring pattern — but every
    // occurrence is somebody else's voice.
    for (let s = 0; s < 3; s++) {
      createSession(db, {
        id: `s-by${s}`,
        originalFilename: `by${s}.wav`,
        format: "wav",
        sizeBytes: 1,
        durationSeconds: 60,
      });
      db.prepare("INSERT INTO analysis_jobs (id, session_id, state) VALUES (?, ?, 'done')").run(
        `j-by${s}`,
        `s-by${s}`,
      );
      const seg = upsertSegment(db, {
        sessionId: `s-by${s}`,
        idx: 0,
        startMs: 0,
        endMs: 1000,
        contentHash: `by${s}`,
      });
      db.prepare("UPDATE segments SET is_user = 0 WHERE id = ?").run(seg.id);
      persistSegmentFindings(db, {
        sessionId: `s-by${s}`,
        contentHash: `by${s}`,
        flagged: true,
        deepDone: true,
        findings: [
          {
            quote: "ho andato",
            correction: "sono andato",
            category: "grammar",
            explanation: "essere with andare",
            severity: "high",
            startMs: 0,
            endMs: 500,
          },
        ],
      });
    }
    materializeSlips(db);
    expect(listSlips(db)).toEqual([]);
  });
});

describe("the SQL and JS forms of the rule cannot drift (E-39 §B1)", () => {
  it("agree verdict-for-verdict over every attribution combination", () => {
    const db = freshDb();
    // One session per combination, so the fixture states the expected answer and the
    // two dialects are asked the same question about the same rows.
    const cases: { id: string; speakers: (0 | 1 | null)[]; excluded: boolean; learner: boolean }[] = [
      { id: "c-null", speakers: [null], excluded: false, learner: true },
      { id: "c-one", speakers: [1], excluded: false, learner: true },
      { id: "c-zero", speakers: [0], excluded: false, learner: false },
      { id: "c-mixed", speakers: [1, 0], excluded: false, learner: false },
      { id: "c-null-excl", speakers: [null], excluded: true, learner: false },
      { id: "c-one-excl", speakers: [1], excluded: true, learner: false },
    ];

    for (const c of cases) {
      createSession(db, {
        id: c.id,
        originalFilename: `${c.id}.wav`,
        format: "wav",
        sizeBytes: 1,
        durationSeconds: 60,
      });
      c.speakers.forEach((isUser, i) => {
        const seg = upsertSegment(db, {
          sessionId: c.id,
          idx: i,
          startMs: i * 1000,
          endMs: i * 1000 + 500,
          contentHash: `${c.id}-hash`,
        });
        db.prepare("UPDATE segments SET is_user = ? WHERE id = ?").run(isUser, seg.id);
      });
      if (c.excluded) setSessionExcluded(db, c.id, true);
    }

    const sqlVerdict = db.prepare(`SELECT ${learnerSpeechSql("?1", "?2")} AS ok`);

    for (const c of cases) {
      // (a) the SQL form, run by SQLite against the seeded rows
      const sql = (sqlVerdict.get({ 1: c.id, 2: `${c.id}-hash` }) as { ok: number }).ok === 1;
      // (b) the JS form, over the same rows read back out
      const segs = db
        .prepare("SELECT is_user FROM segments WHERE session_id = ? AND content_hash = ?")
        .all(c.id, `${c.id}-hash`) as { is_user: 0 | 1 | null }[];
      const js = learnerSpokeAnyOf(segs, { excludeFromEvidence: c.excluded });

      // Both must equal what the FIXTURE says, not merely each other.
      expect({ case: c.id, sql }).toEqual({ case: c.id, sql: c.learner });
      expect({ case: c.id, js }).toEqual({ case: c.id, js: c.learner });
    }
  });

  it("agrees with the per-segment form the cascade applies", () => {
    const db = freshDb();
    const rows: { isUser: 0 | 1 | null; excluded: boolean; learner: boolean }[] = [
      { isUser: null, excluded: false, learner: true },
      { isUser: 1, excluded: false, learner: true },
      { isUser: 0, excluded: false, learner: false },
      { isUser: null, excluded: true, learner: false },
      { isUser: 1, excluded: true, learner: false },
      { isUser: 0, excluded: true, learner: false },
    ];
    const stmt = db.prepare(`SELECT ${learnerSegmentSql("?1", "?2")} AS ok`);
    for (const r of rows) {
      const sql = (stmt.get({ 1: r.isUser, 2: r.excluded ? 1 : 0 }) as { ok: number }).ok === 1;
      const js = learnerSpoke({ isUser: r.isUser, excludeFromEvidence: r.excluded });
      expect({ ...r, sql }).toEqual({ ...r, sql: r.learner });
      expect({ ...r, js }).toEqual({ ...r, js: r.learner });
    }
  });
});
