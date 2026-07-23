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
  createCardForFinding,
  deleteCard,
  generateCards,
  getCard,
  gradeCard,
  listCards,
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
    // FSRS-6 (E-25): a first Good schedules at least a day out — exact interval
    // is the algorithm's, not SM-2's fixed 1; the drill contract is only that a
    // pass leaves the due queue (asserted below).
    expect(after.intervalDays).toBeGreaterThanOrEqual(1);
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

describe("createCardForFinding — the phrasebook pin (E-9)", () => {
  /** The id of the single finding seeded on `sessionId`. */
  function findingId(db: Db, sessionId: string): string {
    return (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
  }

  it("creates one card for a finding and is idempotent (pin twice → one card)", () => {
    const db = freshDb();
    seedFindings(db, "pin", [finding()]);
    const fid = findingId(db, "pin");

    const first = createCardForFinding(db, fid);
    expect(first?.findingId).toBe(fid);
    const again = createCardForFinding(db, fid);
    expect(again?.id).toBe(first?.id); // same card, no duplicate
    expect((db.prepare("SELECT COUNT(*) AS n FROM cards").get() as { n: number }).n).toBe(1);
    // The pinned card is due now → it shows up in the drill queue.
    expect(listDueCards(db).map((c) => c.id)).toEqual([first?.id]);
  });

  it("clears a delete-tombstone so a previously-removed finding returns to the deck", () => {
    const db = freshDb();
    seedFindings(db, "back", [finding()]);
    generateCards(db);
    const cardId = listDueCards(db)[0].id;
    const fid = findingId(db, "back");

    // Remove it from the deck (E-5b): tombstoned, and bulk generate won't revive it.
    deleteCard(db, cardId);
    expect((db.prepare("SELECT COUNT(*) AS n FROM deleted_findings").get() as { n: number }).n).toBe(1);
    expect(generateCards(db)).toBe(0);
    expect(listDueCards(db)).toHaveLength(0);

    // Pinning deliberately adds it back: tombstone gone, card present and due.
    const card = createCardForFinding(db, fid);
    expect(card).not.toBeNull();
    expect((db.prepare("SELECT COUNT(*) AS n FROM deleted_findings").get() as { n: number }).n).toBe(0);
    expect(listDueCards(db).map((c) => c.findingId)).toEqual([fid]);
  });

  it("leaves an existing card's schedule untouched and returns null for an unknown finding", () => {
    const db = freshDb();
    seedFindings(db, "sched", [finding()]);
    generateCards(db);
    const before = listDueCards(db)[0];
    gradeCard(db, before.id, "good"); // advance its SM-2 schedule
    const fid = findingId(db, "sched");

    const pinned = createCardForFinding(db, fid);
    expect(pinned?.id).toBe(before.id);
    expect(pinned?.repetitions).toBe(1); // schedule preserved, not reset
    expect(pinned?.lastGrade).toBe("good");

    expect(createCardForFinding(db, "no-such-finding")).toBeNull();
  });
});

describe("browser: listCards, suspend & delete policy (E-5b)", () => {
  it("listCards returns every card — suspended and future included — soonest-due first", () => {
    const db = freshDb();
    seedFindings(db, "lc", [finding({ quote: "a" }), finding({ quote: "b" }), finding({ quote: "c" })]);
    generateCards(db);
    const byFront = new Map(listCards(db).map((c) => [c.front, c.id]));
    db.prepare("UPDATE cards SET due = datetime('now', '+5 days') WHERE id = ?").run(byFront.get("a"));
    db.prepare("UPDATE cards SET due = datetime('now', '-2 days') WHERE id = ?").run(byFront.get("b"));
    suspendCard(db, byFront.get("c")!, true);

    const all = listCards(db);
    expect(all).toHaveLength(3); // suspended + future both listed, unlike the due queue
    expect(all.map((c) => c.front)).toEqual(["b", "c", "a"]); // -2d, now, +5d
    expect(all.find((c) => c.front === "c")?.suspended).toBe(true);
  });

  it("suspend drops a card from the due queue; unsuspend restores it", () => {
    const db = freshDb();
    seedFindings(db, "su", [finding()]);
    generateCards(db);
    const id = listDueCards(db)[0].id;

    expect(suspendCard(db, id, true)).toBe(true);
    expect(listDueCards(db)).toHaveLength(0); // excluded while suspended
    expect(listCards(db)[0].suspended).toBe(true); // but still visible in the browser

    expect(suspendCard(db, id, false)).toBe(true);
    expect(listDueCards(db).map((c) => c.id)).toEqual([id]); // back in the queue
  });

  it("a deleted card does NOT resurrect on the next generateCards (tombstone policy)", () => {
    const db = freshDb();
    seedFindings(db, "tb", [finding()]);
    generateCards(db);
    const id = listDueCards(db)[0].id;

    expect(deleteCard(db, id)).toBe(true);
    expect(listCards(db)).toHaveLength(0); // gone from the browser
    expect(listDueCards(db)).toHaveLength(0); // and the queue

    expect(generateCards(db)).toBe(0); // the finding still exists, but no card returns
    expect(listCards(db)).toHaveLength(0);
  });

  it("deleting a card's session clears its tombstone (finding gone → nothing to regenerate)", () => {
    const db = freshDb();
    seedFindings(db, "cascade", [finding()]);
    generateCards(db);
    deleteCard(db, listDueCards(db)[0].id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM deleted_findings").get() as { n: number }).n).toBe(1);
    db.prepare("DELETE FROM sessions WHERE id = ?").run("cascade");
    // The FK cascade removed the tombstone with its finding.
    expect((db.prepare("SELECT COUNT(*) AS n FROM deleted_findings").get() as { n: number }).n).toBe(0);
  });
});
