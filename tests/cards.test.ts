import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { persistSegmentFindings, type NewFinding } from "@/lib/analysis/findings";
import {
  cardBack,
  countDueCards,
  deleteCard,
  generateCards,
  getCard,
  gradeCard,
  listDueCards,
  suspendCard,
} from "@/lib/cards";

// The flashcard data layer (E-5 criteria 1–3): generation is one-card-per-finding
// and idempotent; the due queue selects due, non-suspended cards in order; grading
// persists the SM-2 schedule. A real SQLite file per test, torn down after.

const dirs: string[] = [];

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-cards-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

let seq = 0;
/** Seed a session with `findings` findings, each on its own content hash. */
function seedFindings(db: Db, sessionId: string, findings: NewFinding[]): void {
  createSession(db, {
    id: sessionId,
    originalFilename: `${sessionId}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 60,
  });
  for (const f of findings) {
    persistSegmentFindings(db, {
      sessionId,
      contentHash: `${sessionId}-h${seq++}`,
      flagged: true,
      deepDone: true,
      findings: [f],
    });
  }
}

function finding(over: Partial<NewFinding> = {}): NewFinding {
  return {
    quote: "he go to work",
    correction: "he goes to work",
    category: "grammar",
    explanation: "Third-person singular takes -s.",
    severity: "high",
    startMs: 5000,
    endMs: 6000,
    ...over,
  };
}

describe("generateCards", () => {
  it("creates exactly one card per finding and is idempotent", () => {
    const db = freshDb();
    seedFindings(db, "s1", [finding(), finding(), finding()]);

    expect(generateCards(db)).toBe(3); // N findings → N cards
    expect(generateCards(db)).toBe(0); // second run adds nothing
    const n = db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number };
    expect(n.n).toBe(3); // still N
  });

  it("carries the finding's text, category, session and timestamp onto the card", () => {
    const db = freshDb();
    seedFindings(db, "s2", [
      finding({ quote: "I have 20 years", correction: "I am 20 years old", explanation: "Age uses 'to be'.", category: "phrasing", startMs: 42_000 }),
    ]);
    generateCards(db);
    const card = listDueCards(db)[0];
    expect(card.front).toBe("I have 20 years"); // front = the quote in context
    expect(card.back).toBe(cardBack("I am 20 years old", "Age uses 'to be'.")); // correction + why
    expect(card.category).toBe("phrasing");
    expect(card.sessionId).toBe("s2");
    expect(card.startMs).toBe(42_000);
  });

  it("only ever makes one card per finding even across many runs", () => {
    const db = freshDb();
    seedFindings(db, "s3", [finding()]);
    generateCards(db);
    seedFindings(db, "s3b", [finding(), finding()]); // two more findings appear later
    expect(generateCards(db)).toBe(2); // only the new ones
    expect((db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n).toBe(3);
  });
});

describe("listDueCards / countDueCards", () => {
  it("returns due, non-suspended cards most-overdue-first and excludes future & suspended", () => {
    const db = freshDb();
    seedFindings(db, "q", [finding({ quote: "a" }), finding({ quote: "b" }), finding({ quote: "c" })]);
    generateCards(db);
    const [a, b, c] = listDueCards(db);

    // Push `a` a day into the future and suspend `b`; only `c` should remain due.
    db.prepare("UPDATE cards SET due = datetime('now', '+1 day') WHERE id = ?").run(a.id);
    suspendCard(db, b.id, true);

    const due = listDueCards(db);
    expect(due.map((x) => x.id)).toEqual([c.id]);
    expect(countDueCards(db)).toBe(1);
  });

  it("orders by due ascending — the most overdue card comes first", () => {
    const db = freshDb();
    seedFindings(db, "o", [finding({ quote: "recent" }), finding({ quote: "old" })]);
    generateCards(db);
    const byFront = new Map(listDueCards(db).map((c) => [c.front, c.id]));
    db.prepare("UPDATE cards SET due = datetime('now', '-10 days') WHERE id = ?").run(byFront.get("old"));
    db.prepare("UPDATE cards SET due = datetime('now', '-1 day') WHERE id = ?").run(byFront.get("recent"));
    expect(listDueCards(db).map((x) => x.front)).toEqual(["old", "recent"]);
  });
});

describe("gradeCard", () => {
  it("persists the SM-2 schedule and pushes Good's due into the future", () => {
    const db = freshDb();
    seedFindings(db, "g", [finding()]);
    generateCards(db);
    const before = listDueCards(db)[0];

    const after = gradeCard(db, before.id, "good");
    expect(after.repetitions).toBe(1);
    expect(after.intervalDays).toBe(1);
    expect(after.lastGrade).toBe("good");
    // due moved forward, so the card is no longer in the due queue.
    expect(listDueCards(db)).toHaveLength(0);

    // The change is durable across a fresh read.
    expect(getCard(db, before.id)?.lastGrade).toBe("good");
  });

  it("keeps an Again-graded card due immediately and lowers its ease", () => {
    const db = freshDb();
    seedFindings(db, "ag", [finding()]);
    generateCards(db);
    const before = listDueCards(db)[0];
    const after = gradeCard(db, before.id, "again");
    expect(after.intervalDays).toBe(0);
    expect(after.ease).toBeLessThan(before.ease);
    expect(countDueCards(db)).toBe(1); // still due this session
  });
});

describe("cascade + helpers", () => {
  it("deletes a session's cards when the session (its findings) is deleted", () => {
    const db = freshDb();
    seedFindings(db, "del", [finding(), finding()]);
    generateCards(db);
    expect((db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n).toBe(2);
    db.prepare("DELETE FROM sessions WHERE id = ?").run("del");
    expect((db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n).toBe(0);
  });

  it("deleteCard removes a single card and reports whether it existed", () => {
    const db = freshDb();
    seedFindings(db, "d1", [finding()]);
    generateCards(db);
    const id = listDueCards(db)[0].id;
    expect(deleteCard(db, id)).toBe(true);
    expect(deleteCard(db, id)).toBe(false);
  });
});
