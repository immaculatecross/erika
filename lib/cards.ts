import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { schedule, FRESH_EASE, type Grade } from "./srs";
import { cardBack, type CardView } from "./cards-view";

export { cardBack, splitBack } from "./cards-view";

// Typed data layer for flashcards (E-5), in the lib/settings.ts / lib/segments.ts
// style. Server-only. Cards are generated from analysis findings — one per
// finding, deduplicated by the `finding_id` UNIQUE constraint — and scheduled by
// the pure SM-2 scheduler in lib/srs.ts; this module is the seam between that
// scheduler and the `cards` table (turning an interval into a concrete `due`).
//
// `due` is stored as a SQLite-comparable UTC timestamp (datetime('now', …)) so
// the due queue is a plain `due <= now`, and the browser/export helpers E-5b will
// surface (`suspendCard`, `deleteCard`) are provided here without any UI yet.

export interface Card {
  id: string;
  findingId: string;
  sessionId: string;
  front: string;
  back: string;
  category: string;
  startMs: number;
  ease: number;
  intervalDays: number;
  repetitions: number;
  due: string;
  lastGrade: Grade | null;
  suspended: boolean;
}

interface CardRow {
  id: string;
  finding_id: string;
  session_id: string;
  front: string;
  back: string;
  category: string;
  start_ms: number;
  ease: number;
  interval_days: number;
  repetitions: number;
  due: string;
  last_grade: Grade | null;
  suspended: number;
}

function toCard(r: CardRow): Card {
  return {
    id: r.id,
    findingId: r.finding_id,
    sessionId: r.session_id,
    front: r.front,
    back: r.back,
    category: r.category,
    startMs: r.start_ms,
    ease: r.ease,
    intervalDays: r.interval_days,
    repetitions: r.repetitions,
    due: r.due,
    lastGrade: r.last_grade,
    suspended: !!r.suspended,
  };
}

/** A card reduced to the client-safe view the drill renders. */
export function toCardView(c: Card): CardView {
  return { id: c.id, front: c.front, back: c.back, category: c.category };
}

interface GeneratableFinding {
  id: string;
  session_id: string;
  quote: string;
  correction: string;
  explanation: string;
  category: string;
  start_ms: number;
}

/**
 * Create one card per finding that does not have one yet, due immediately for a
 * first review. Idempotent: findings already carrying a card are skipped by the
 * `NOT EXISTS` filter and, belt-and-braces, the `finding_id` UNIQUE key + INSERT
 * OR IGNORE makes a concurrent second run a no-op. Returns the number created.
 */
export function generateCards(db: Db): number {
  const findings = db
    .prepare(
      `SELECT f.id, f.session_id, f.quote, f.correction, f.explanation, f.category, f.start_ms
         FROM findings f
        WHERE NOT EXISTS (SELECT 1 FROM cards c WHERE c.finding_id = f.id)`,
    )
    .all() as GeneratableFinding[];

  const insert = db.prepare(
    `INSERT OR IGNORE INTO cards
       (id, finding_id, session_id, front, back, category, start_ms, ease, interval_days, repetitions, due, suspended)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), 0)`,
  );

  let created = 0;
  db.transaction(() => {
    for (const f of findings) {
      const info = insert.run(
        randomUUID(),
        f.id,
        f.session_id,
        f.quote,
        cardBack(f.correction, f.explanation),
        f.category,
        f.start_ms,
        FRESH_EASE,
      );
      created += info.changes;
    }
  })();
  return created;
}

const SELECT_CARD = "SELECT * FROM cards";

/** Cards due now and not suspended, most overdue first (a stable total order). */
export function listDueCards(db: Db): Card[] {
  const rows = db
    .prepare(
      `${SELECT_CARD}
        WHERE suspended = 0 AND due <= datetime('now')
        ORDER BY due ASC, created_at ASC, id ASC`,
    )
    .all() as CardRow[];
  return rows.map(toCard);
}

/** How many cards are due now (not suspended) — the Practice screen's count. */
export function countDueCards(db: Db): number {
  const r = db
    .prepare("SELECT COUNT(*) AS n FROM cards WHERE suspended = 0 AND due <= datetime('now')")
    .get() as { n: number };
  return r.n;
}

/** One card by id, or null. */
export function getCard(db: Db, id: string): Card | null {
  const r = db.prepare(`${SELECT_CARD} WHERE id = ?`).get(id) as CardRow | undefined;
  return r ? toCard(r) : null;
}

/**
 * Grade a card: run the pure SM-2 scheduler over its current state and persist
 * the new ease/interval/repetitions, the grade, and a concrete `due` derived
 * from the interval (0 days = due now, so a lapsed card returns this session).
 */
export function gradeCard(db: Db, id: string, grade: Grade): Card {
  const card = getCard(db, id);
  if (!card) throw new Error(`No card ${id}.`);
  const next = schedule(
    { ease: card.ease, intervalDays: card.intervalDays, repetitions: card.repetitions },
    grade,
  );
  db.prepare(
    `UPDATE cards
        SET ease = ?, interval_days = ?, repetitions = ?, last_grade = ?, due = datetime('now', ?)
      WHERE id = ?`,
  ).run(next.ease, next.intervalDays, next.repetitions, next.lastGrade, `+${next.intervalDays} days`, id);
  return getCard(db, id)!;
}

/** Suspend or un-suspend a card (its UI is E-5b). Returns whether a row changed. */
export function suspendCard(db: Db, id: string, suspended: boolean): boolean {
  return db.prepare("UPDATE cards SET suspended = ? WHERE id = ?").run(suspended ? 1 : 0, id).changes > 0;
}

/** Delete a card (its UI is E-5b). Returns whether a row existed. */
export function deleteCard(db: Db, id: string): boolean {
  return db.prepare("DELETE FROM cards WHERE id = ?").run(id).changes > 0;
}
