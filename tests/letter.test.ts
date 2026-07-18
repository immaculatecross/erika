import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { enqueueAnalysis } from "@/lib/analysis/cascade";
import {
  buildLetter,
  computeLetter,
  composeWeek,
  isoWeekStart,
  selectRecasts,
  type Category,
  type LetterFinding,
  type LetterSession,
  type Severity,
} from "@/lib/letter";

// The editor's letter composition (E-12). `computeLetter`/`composeWeek`/
// `selectRecasts` are pure, so the acceptance criteria are hand-computable: ISO
// week bounds (Mon→Sun UTC), the trend direction vs the *prior* calendar week (no
// fake trend when there is none), the deterministic best-recasts pick, and the
// focus-next category. A final DB pass drives the real accessor to prove only
// *analyzed* sessions are read. 2026-07-13 is a Monday, 2026-07-06 the Monday before.

const HOUR = 3_600_000;
const CURRENT_WEEK = "2026-07-13"; // Mon 2026-07-13 → Sun 2026-07-19
const PRIOR_WEEK = "2026-07-06"; // the Monday immediately before

let seq = 0;
function f(over: Partial<LetterFinding> = {}): LetterFinding {
  const id = `f${seq++}`;
  return {
    id,
    quote: `you say ${id}`,
    correction: `natives say ${id}`,
    explanation: "why this reads as non-native",
    category: "grammar",
    severity: "medium",
    ...over,
  };
}

function sess(over: Partial<LetterSession> = {}): LetterSession {
  return { id: "s", createdAt: `${CURRENT_WEEK} 09:00:00`, speechMs: HOUR, findings: [], ...over };
}

describe("isoWeekStart — Monday-anchored ISO weeks (criterion 1)", () => {
  it("maps every day of a week to that week's Monday, in UTC", () => {
    expect(isoWeekStart("2026-07-13 00:00:00")).toBe("2026-07-13"); // Monday itself
    expect(isoWeekStart("2026-07-15 12:30:00")).toBe("2026-07-13"); // Wednesday
    expect(isoWeekStart("2026-07-19 23:59:59")).toBe("2026-07-13"); // Sunday
    expect(isoWeekStart("2026-07-20 00:00:00")).toBe("2026-07-20"); // next Monday
    expect(isoWeekStart("2026-07-12 09:00:00")).toBe("2026-07-06"); // prior Sunday → prior Monday
  });
});

describe("composeWeek — bounds, headline figures, focus-next (criteria 1 & 4)", () => {
  it("sets Monday→Sunday bounds and the real findings-over-hours rate", () => {
    const letter = composeWeek(
      [sess({ id: "a", speechMs: HOUR, findings: [f({ category: "grammar" }), f({ category: "grammar" })] })],
      CURRENT_WEEK,
    );
    expect(letter.weekStart).toBe("2026-07-13");
    expect(letter.weekEnd).toBe("2026-07-19");
    expect(letter.speechHours).toBe(1);
    expect(letter.totalFindings).toBe(2);
    expect(letter.ratePerHour).toBe(2); // 2 findings / 1 h — the truthful figure
    expect(letter.analyzedSessions).toBe(1);
  });

  it("names the one thing next week by the top severity-weighted rate", () => {
    // idiom 2×high = weight 6 (ranks first); grammar 3×low = weight 3.
    const letter = composeWeek(
      [
        sess({
          id: "a",
          speechMs: HOUR,
          findings: [
            f({ category: "idiom", severity: "high" }),
            f({ category: "idiom", severity: "high" }),
            f({ category: "grammar", severity: "low" }),
            f({ category: "grammar", severity: "low" }),
            f({ category: "grammar", severity: "low" }),
          ],
        }),
      ],
      CURRENT_WEEK,
    );
    expect(letter.focusNext?.category).toBe("idiom");
    expect(letter.focusNext?.count).toBe(2);
  });
});

describe("composeWeek — trend vs the prior week (criterion 2)", () => {
  const prior = sess({ id: "p", createdAt: `${PRIOR_WEEK} 09:00:00`, speechMs: HOUR, findings: [f(), f(), f(), f()] }); // 4/h
  const current = sess({ id: "c", createdAt: `${CURRENT_WEEK} 09:00:00`, speechMs: HOUR, findings: [f()] }); // 1/h

  it("reads a falling rate as improving and carries both weeks' rates", () => {
    const letter = composeWeek([prior, current], CURRENT_WEEK);
    expect(letter.trend.hasPrior).toBe(true);
    expect(letter.trend.prior).toBe(4);
    expect(letter.trend.current).toBe(1);
    expect(letter.trend.direction).toBe("improving"); // 4/h → 1/h
  });

  it("reads a rising rate as worsening — and says so truthfully (criterion 4)", () => {
    const worse = sess({ id: "c", createdAt: `${CURRENT_WEEK} 09:00:00`, speechMs: HOUR, findings: [f(), f(), f(), f(), f(), f()] }); // 6/h
    const letter = composeWeek([prior, worse], CURRENT_WEEK);
    expect(letter.trend.direction).toBe("worsening"); // 4/h → 6/h, not sugar-coated
    expect(letter.ratePerHour).toBe(6);
  });

  it("reports NO trend when there is no prior week — no fabricated direction", () => {
    const letter = composeWeek([current], CURRENT_WEEK);
    expect(letter.trend.hasPrior).toBe(false);
    expect(letter.trend.prior).toBeNull();
    expect(letter.trend.direction).toBe("flat"); // inert; the UI shows no badge when !hasPrior
  });
});

describe("selectRecasts — deterministic best-recasts pick (criterion 3)", () => {
  it("sorts by severity, de-duplicates, and prefers distinct categories, up to 3", () => {
    const f1 = f({ id: "f1", quote: "same", correction: "SAME", category: "grammar", severity: "high" });
    const f2 = f({ id: "f2", category: "idiom", severity: "high" });
    const f3 = f({ id: "f3", category: "grammar", severity: "medium" });
    const f4 = f({ id: "f4", category: "vocabulary", severity: "low" });
    const dup = f({ id: "f5", quote: "same", correction: "SAME", category: "grammar", severity: "high" });
    const picked = selectRecasts([f3, dup, f4, f1, f2]);
    // f1 (high grammar) and f2 (high idiom) lead; the duplicate of f1 is dropped;
    // f3 (another grammar) is skipped for the fresh category f4 (vocabulary).
    expect(picked.map((p) => p.id)).toEqual(["f1", "f2", "f4"]);
  });

  it("falls back to same-category fills when distinct categories run out", () => {
    const g1 = f({ id: "g1", category: "grammar", severity: "high", quote: "a", correction: "A" });
    const g2 = f({ id: "g2", category: "grammar", severity: "medium", quote: "b", correction: "B" });
    const g3 = f({ id: "g3", category: "grammar", severity: "low", quote: "c", correction: "C" });
    expect(selectRecasts([g3, g1, g2]).map((p) => p.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("carries both sides and the why onto each selected recast", () => {
    const [only] = selectRecasts([f({ id: "x", quote: "I have 20 years", correction: "I am 20" })]);
    expect(only.quote).toBe("I have 20 years");
    expect(only.correction).toBe("I am 20");
    expect(only.explanation).toBeTruthy();
  });
});

describe("computeLetter — latest week and the empty case", () => {
  it("chooses the most recent week that has findings", () => {
    const older = sess({ id: "p", createdAt: `${PRIOR_WEEK} 09:00:00`, findings: [f()] });
    const newer = sess({ id: "c", createdAt: `${CURRENT_WEEK} 09:00:00`, findings: [f()] });
    expect(computeLetter([older, newer])?.weekStart).toBe(CURRENT_WEEK);
  });

  it("returns null when nothing is analyzed or no week has findings", () => {
    expect(computeLetter([])).toBeNull();
    expect(computeLetter([sess({ findings: [] })])).toBeNull();
  });
});

describe("buildLetter — only analyzed sessions are read (criterion 1 data path)", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-letter-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  function seed(db: Db, id: string, createdAt: string, cats: Category[], analyzed: boolean) {
    createSession(db, { id, originalFilename: `${id}.wav`, format: "wav", sizeBytes: 1, durationSeconds: 3600 });
    db.prepare("UPDATE sessions SET created_at = ? WHERE id = ?").run(createdAt, id); // pin the week
    upsertSegment(db, { sessionId: id, idx: 0, startMs: 0, endMs: HOUR, contentHash: `${id}-h0` });
    persistSegmentFindings(db, {
      sessionId: id,
      contentHash: `${id}-h0`,
      flagged: true,
      deepDone: true,
      findings: cats.map((category, i) => ({
        quote: `q${i}`,
        correction: `c${i}`,
        category,
        explanation: "e",
        severity: "high" as Severity,
        startMs: i * 1000,
        endMs: i * 1000 + 500,
      })),
    });
    if (analyzed) {
      const job = enqueueAnalysis(db, id);
      db.prepare("UPDATE analysis_jobs SET state='done', progress=1 WHERE id=?").run(job.id);
    }
  }

  it("is null over a fresh DB", () => {
    expect(buildLetter(freshDb())).toBeNull();
  });

  it("composes the latest analyzed week and its trend, ignoring un-analyzed sessions", () => {
    const db = freshDb();
    seed(db, "prior", `${PRIOR_WEEK} 09:00:00`, ["grammar", "grammar", "grammar", "grammar"], true); // 4/h
    seed(db, "current", `${CURRENT_WEEK} 09:00:00`, ["grammar"], true); // 1/h
    seed(db, "pending", `${CURRENT_WEEK} 12:00:00`, ["idiom", "idiom", "idiom"], false); // must be ignored
    const letter = buildLetter(db);
    expect(letter?.weekStart).toBe(CURRENT_WEEK);
    expect(letter?.totalFindings).toBe(1); // only the analyzed current-week session
    expect(letter?.trend.prior).toBe(4);
    expect(letter?.trend.direction).toBe("improving");
    expect(letter?.focusNext?.category).toBe("grammar");
    expect(letter?.recasts).toHaveLength(1);
  });
});
