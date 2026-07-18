import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings, type Category } from "@/lib/analysis/findings";
import { enqueueAnalysis, type AnalysisState } from "@/lib/analysis/cascade";
import { generateCards } from "@/lib/cards";
import { recordCompletion } from "@/lib/lessons/mastery";
import { buildFocusPayload } from "@/lib/focus";
import {
  buildSlipsIndex,
  buildTimeline,
  clusterFindings,
  computeSlipStanding,
  getSlipDossier,
  listSlips,
  materializeSlips,
  normalizeCorrection,
  resolvedSlipCount,
  shortDate,
  statusLine,
  RESOLVED_CLEAN_SESSIONS,
  type DossierItem,
  type SlipFinding,
} from "@/lib/slips";

// E-20 Slips. The pure core (clustering with a stable key that folds clipped
// recurrence links, and the active/remission/resolved state) is hand-checked
// against fixtures; the DB layer is driven through the canonical read-model so a
// FAILED run's completed segments count as analysed exactly like a done run.

const HOUR = 3_600_000;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-slips-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

// ── pure clustering ──────────────────────────────────────────────────────────

describe("clusterFindings (criterion 1)", () => {
  it("groups by normalized correction + category into one slip with a stable key", () => {
    const findings: SlipFinding[] = [
      { id: "a", category: "grammar", correction: "Las manzanas", recurrenceOf: null },
      { id: "b", category: "grammar", correction: "las manzanas.", recurrenceOf: null },
      { id: "c", category: "vocabulary", correction: "las manzanas", recurrenceOf: null }, // different category
    ];
    const clusters = clusterFindings(findings);
    expect(clusters).toHaveLength(2);
    const grammar = clusters.find((c) => c.category === "grammar")!;
    expect(grammar.findingIds).toEqual(["a", "b"]); // case + trailing punct normalized
    expect(grammar.key).toBe("grammar:las manzanas");
    // Re-clustering the same set is byte-identical — the key survives re-analysis.
    expect(clusterFindings(findings)).toEqual(clusters);
  });

  it("folds a >60-char recurrence link by PREFIX, never by string equality", () => {
    // A full correction longer than the profile's 60-char clip; a second finding
    // whose OWN wording differs but which the model marked as recurring it — so it
    // carries only the clipped (59-char + ellipsis) correction as its link.
    const long = "you should use the present perfect for an action continuing into now";
    expect(long.length).toBeGreaterThan(60);
    const clipped = `${long.slice(0, 59)}…`; // exactly what lib/analysis/profile.ts stores
    const findings: SlipFinding[] = [
      { id: "a", category: "grammar", correction: long, recurrenceOf: null },
      { id: "b", category: "grammar", correction: "use the present perfect here", recurrenceOf: clipped },
    ];
    // The clip is NOT equal to the full correction — equality clustering would miss it.
    expect(normalizeCorrection(clipped)).not.toBe(normalizeCorrection(long));
    expect(normalizeCorrection(long).startsWith(normalizeCorrection(clipped))).toBe(true);

    const clusters = clusterFindings(findings);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].findingIds).toEqual(["a", "b"]);
    expect(clusters[0].correction).toBe(long); // the fuller phrasing represents the slip
  });
});

// ── pure state + copy ────────────────────────────────────────────────────────

describe("computeSlipStanding + statusLine (criterion 2)", () => {
  const last = "2026-07-13 09:00:00";
  const later = (n: number) => Array.from({ length: n }, (_, i) => `2026-07-${14 + i} 09:00:00`);

  it("resolves after N clean analysed sessions, remits below N, else active", () => {
    expect(computeSlipStanding(last, later(RESOLVED_CLEAN_SESSIONS)).state).toBe("resolved");
    expect(computeSlipStanding(last, later(RESOLVED_CLEAN_SESSIONS - 1)).state).toBe("remission");
    expect(computeSlipStanding(last, []).state).toBe("active");
    // Sessions at or before the last occurrence never count as clean-since.
    expect(computeSlipStanding(last, ["2026-07-01 09:00:00", last]).cleanSessionsSince).toBe(0);
  });

  it("writes the real-date status copy the UI shows", () => {
    expect(shortDate(last)).toBe("13 Jul");
    expect(statusLine(computeSlipStanding(last, later(3)))).toBe("Not heard since 13 Jul · 3 sessions clean");
    expect(statusLine(computeSlipStanding(last, later(1)))).toBe("Not heard since 13 Jul · 1 session clean");
    expect(statusLine(computeSlipStanding(last, []))).toBe("Still active — last heard 13 Jul");
  });
});

describe("buildTimeline (criterion 3)", () => {
  it("interleaves chronologically, occurrences before drill on a tie", () => {
    const items: DossierItem[] = [
      { kind: "mastery", at: "2026-07-10 09:00:00", category: "grammar", mastery: 0.5 },
      { kind: "card", at: "2026-07-05 09:00:00", grade: "good", repetitions: 1, due: "2026-07-06 09:00:00" },
      { kind: "occurrence", at: "2026-07-05 09:00:00", findingId: "f", quote: "q", correction: "c", sessionId: "s", startMs: 0, sessionFilename: "s.wav" },
    ];
    expect(buildTimeline(items).map((i) => `${i.at}:${i.kind}`)).toEqual([
      "2026-07-05 09:00:00:occurrence",
      "2026-07-05 09:00:00:card",
      "2026-07-10 09:00:00:mastery",
    ]);
  });
});

// ── DB layer ─────────────────────────────────────────────────────────────────

/** Seed one analysed session: a base analysed (finding-free) segment guarantees
 *  it is an analysed session even when clean, plus one finding per correction. */
function seed(
  db: Db,
  id: string,
  day: string,
  corrections: [string, Category][],
  state: AnalysisState = "done",
): void {
  createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
  db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(`${day} 09:00:00`, id);
  upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: `${id}-base` });
  persistSegmentFindings(db, { sessionId: id, contentHash: `${id}-base`, flagged: false, deepDone: false, findings: [] });
  corrections.forEach(([correction, category], i) => {
    const hash = `${id}-h${i}`;
    upsertSegment(db, { sessionId: id, idx: i + 1, startMs: (i + 1) * HOUR, endMs: (i + 2) * HOUR, contentHash: hash });
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: hash,
      flagged: true,
      deepDone: true,
      findings: [{ quote: `${id}-q${i}`, correction, category, explanation: "why", severity: "high", startMs: (i + 1) * HOUR, endMs: (i + 1) * HOUR + 500 }],
    });
  });
  const job = enqueueAnalysis(db, id);
  db.prepare("UPDATE analysis_jobs SET state = ?, progress = 1 WHERE id = ?").run(state, job.id);
}

describe("materializeSlips (criterion 1 persistence)", () => {
  it("persists one slip per cluster, the association, and is id-stable across re-analysis", () => {
    const db = freshDb();
    seed(db, "s1", "2026-07-01", [["las manzanas", "grammar"]]);
    seed(db, "s2", "2026-07-05", [["Las manzanas.", "grammar"]]); // same slip, later session

    materializeSlips(db);
    const slips = db.prepare("SELECT id, slip_key FROM slips").all() as { id: string; slip_key: string }[];
    expect(slips).toHaveLength(1);
    const assoc = db.prepare("SELECT finding_id, slip_id FROM finding_slips").all() as { finding_id: string; slip_id: string }[];
    expect(assoc).toHaveLength(2); // both findings point at the one slip
    expect(new Set(assoc.map((a) => a.slip_id))).toEqual(new Set([slips[0].id]));

    // Re-analysis (a second materialize) keeps the same id and key — no churn.
    materializeSlips(db);
    const again = db.prepare("SELECT id, slip_key FROM slips").all() as { id: string; slip_key: string }[];
    expect(again).toEqual(slips);
    db.close();
  });
});

describe("listSlips + state from later analysed sessions (criterion 2 data path)", () => {
  it("counts a FAILED run's completed segments as clean analysed sessions → resolved", () => {
    const db = freshDb();
    seed(db, "occ", "2026-07-01", [["usar el subjuntivo", "grammar"]]);
    // Three later analysed sessions that do NOT recur the slip. Their runs FAILED,
    // but each completed its base segment — so they count as analysed (findings-model
    // semantics), and the slip is resolved. This is the named home for that rule.
    seed(db, "clean1", "2026-07-05", [], "failed");
    seed(db, "clean2", "2026-07-06", [], "failed");
    seed(db, "clean3", "2026-07-07", [], "failed");

    materializeSlips(db);
    const slips = listSlips(db);
    expect(slips).toHaveLength(1);
    expect(slips[0].occurrences).toBe(1);
    expect(slips[0].lastSeenAt).toBe("2026-07-01 09:00:00");
    expect(slips[0].standing.cleanSessionsSince).toBe(3);
    expect(slips[0].standing.state).toBe("resolved");
    expect(slips[0].statusLine).toBe("Not heard since 1 Jul · 3 sessions clean");

    expect(resolvedSlipCount(db)).toBe(1);
    expect(buildSlipsIndex(db).resolvedCount).toBe(1);
    db.close();
  });

  it("is active while the slip is still the most recent thing heard", () => {
    const db = freshDb();
    seed(db, "occ", "2026-07-01", [["mistake here", "phrasing"]]);
    materializeSlips(db);
    expect(listSlips(db)[0].standing.state).toBe("active");
    expect(resolvedSlipCount(db)).toBe(0);
    db.close();
  });
});

describe("getSlipDossier (criterion 3)", () => {
  it("interleaves every occurrence with the SM-2 card and lesson mastery drill", () => {
    const db = freshDb();
    seed(db, "s1", "2020-01-01", [["las manzanas", "grammar"]]);
    seed(db, "s2", "2020-01-02", [["las manzanas", "grammar"]]);
    generateCards(db); // one card per finding — the drill history
    recordCompletion(db, "category:grammar", 1); // lesson mastery for the slip's category

    materializeSlips(db);
    const slipId = (db.prepare("SELECT id FROM slips").get() as { id: string }).id;
    const dossier = getSlipDossier(db, slipId)!;
    expect(dossier.occurrences).toBe(2);
    const kinds = dossier.timeline.map((i) => i.kind);
    expect(kinds.filter((k) => k === "occurrence")).toHaveLength(2);
    expect(kinds.filter((k) => k === "card")).toHaveLength(2);
    expect(kinds.filter((k) => k === "mastery")).toHaveLength(1);

    // Occurrences carry the jump-to-audio deep-link data and are chronological.
    const occ = dossier.timeline.filter((i) => i.kind === "occurrence");
    expect(occ.map((o) => o.at)).toEqual(["2020-01-01 09:00:00", "2020-01-02 09:00:00"]);
    expect(occ[0]).toMatchObject({ sessionId: "s1", startMs: HOUR });

    expect(getSlipDossier(db, "no-such-slip")).toBeNull();
    db.close();
  });
});

describe("Focus integration (criterion 4)", () => {
  it("buildFocusPayload carries the resolved-slip count without touching the ranking", () => {
    const db = freshDb();
    seed(db, "occ", "2026-07-01", [["resolved habit", "idiom"]]);
    seed(db, "c1", "2026-07-05", [], "done");
    seed(db, "c2", "2026-07-06", [], "done");
    seed(db, "c3", "2026-07-07", [], "done");
    const payload = buildFocusPayload(db);
    expect(payload.resolvedSlips).toBe(1);
    // The metric model is unchanged — ranking is still all five categories.
    expect(payload.ranking).toHaveLength(5);
    db.close();
  });
});
