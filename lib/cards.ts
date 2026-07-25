import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { INCLUDED_FINDING_SCOPE } from "./findings-model";
import { schedule, FRESH_EASE, type Grade } from "./srs";
import { recordEvidence } from "./knowledge";
import { cardBack, deriveFaces, type CardView, type CardBrowserView, type CardFaces } from "./cards-view";
import type { CsvCard } from "./cards-csv";

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
  /** The knowledge item this card's reviews are evidence for (E-25), or null until
   *  the deep pass (E-28) attaches a validated lemma to its finding. */
  itemId: string | null;
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
  item_id: string | null;
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
    itemId: r.item_id,
  };
}

// The display views are correction-forward (E-29, D-18): the faces a user sees are
// re-derived from the card's JOINED finding at read time — front = meaning-first
// cue, correction = target, error shown once on the back — so no card is stored
// with the error as its stimulus and existing cards flip automatically, with no
// migration and no stored-front backfill (the `cards.front/back` columns still hold
// the finding copy generation wrote; display no longer reads them). `deriveFaces`
// is the one pure derivation, shared with the client.

/** A card row joined to its finding — the canonical fields the display re-derives from. */
interface CardFindingRow extends CardRow {
  f_quote: string;
  f_correction: string;
  f_explanation: string;
}

const SELECT_CARD_VIEW = `
  SELECT c.*, f.quote AS f_quote, f.correction AS f_correction, f.explanation AS f_explanation
    FROM cards c
    JOIN findings f ON f.id = c.finding_id`;

/** The four display faces for a joined card row (E-29), derived from the finding. */
function facesOf(r: CardFindingRow): CardFaces {
  return deriveFaces(r.f_quote, r.f_correction, r.f_explanation, r.category);
}

function toCardViewJoined(r: CardFindingRow): CardView {
  return { id: r.id, findingId: r.finding_id, category: r.category, ...facesOf(r) };
}

/** Due, non-suspended cards as correction-forward drill views (E-29), most-overdue first. */
export function listDueCardViews(db: Db): CardView[] {
  const rows = db
    .prepare(
      `${SELECT_CARD_VIEW}
        WHERE c.suspended = 0 AND c.due <= datetime('now')
        ORDER BY c.due ASC, c.created_at ASC, c.id ASC`,
    )
    .all() as CardFindingRow[];
  return rows.map(toCardViewJoined);
}

/** Every card as a browser view (E-5b) with derived faces plus due/suspended (E-29). */
export function listCardBrowserViews(db: Db): CardBrowserView[] {
  const rows = db
    .prepare(`${SELECT_CARD_VIEW} ORDER BY c.due ASC, c.created_at ASC, c.id ASC`)
    .all() as CardFindingRow[];
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    ...facesOf(r),
    due: r.due,
    suspended: !!r.suspended,
  }));
}

/** One card's correction-forward drill view by id, or null. */
export function getCardView(db: Db, id: string): CardView | null {
  const r = db.prepare(`${SELECT_CARD_VIEW} WHERE c.id = ?`).get(id) as CardFindingRow | undefined;
  return r ? toCardViewJoined(r) : null;
}

/**
 * The Anki CSV rows (E-5b), correction-forward (E-29): Front is the meaning-first
 * cue, Back headlines the correction and reason, then shows the error once,
 * labelled — the one confrontation, carried into the export too.
 */
export function listCardsCsv(db: Db): CsvCard[] {
  const rows = db
    .prepare(`${SELECT_CARD_VIEW} ORDER BY c.due ASC, c.created_at ASC, c.id ASC`)
    .all() as CardFindingRow[];
  return rows.map((r) => {
    const faces = facesOf(r);
    const back = [faces.correction, ...(faces.why ? [faces.why] : []), `You said: ${faces.error}`].join(
      "\n\n",
    );
    return { front: faces.front, back };
  });
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

// ---- what cannot become a card (E-37) --------------------------------------
//
// A card's front is derived by diffing the error against the correction
// (`deriveFront`), so it needs a localized textual change to cue from. A PRONUNCIATION
// finding has none — the spelling was never wrong — so the front degrades to a bare
// "____ · pronunciation": a prompt nobody can answer, and precisely the defect
// RETRO-003 named. Such findings belong to the pronunciation studio, where the learner
// hears the correct line and says it back.
//
// This is a routing decision about a card's FORMAT, not a second findings gate: the
// finding is as included as it ever was, and it is fully present in the Phrasebook, the
// Archive and the report. One constant serves BOTH card paths — bulk generation and the
// deliberate pin — so neither can produce an unanswerable card.

export const UNCARDABLE_CATEGORIES: ReadonlySet<string> = new Set(["pronunciation"]);

/** Whether a finding of this category can become an answerable card. */
export function isCardable(category: string): boolean {
  return !UNCARDABLE_CATEGORIES.has(category);
}

/** The SQL form of `isCardable`, built from the same constant. The values are internal
 *  literals from the closed `CATEGORIES` vocabulary, never user input. */
const CARDABLE_CATEGORY_SQL = `f.category NOT IN (${[...UNCARDABLE_CATEGORIES]
  .map((c) => `'${c}'`)
  .join(", ")})`;

/**
 * Create one card per finding that does not have one yet, due immediately for a
 * first review. Idempotent: findings already carrying a card are skipped by the
 * `NOT EXISTS` filter and, belt-and-braces, the `finding_id` UNIQUE key + INSERT
 * OR IGNORE makes a concurrent second run a no-op. Returns the number created.
 *
 * Which findings are eligible is NOT decided here: `INCLUDED_FINDING_SCOPE` is the
 * canonical read-model's scope (lib/findings-model.ts, E-17), the same one the
 * Phrasebook, the Archive, the lesson patterns, Focus and the letter read. The other
 * `NOT EXISTS` clauses on top are deck bookkeeping — already carded, or tombstoned
 * by a deliberate delete — not a second opinion about what a finding is.
 *
 * [E-37] UNCARDABLE findings are excluded — see `UNCARDABLE_CATEGORIES`. Both this
 * bulk path and the deliberate Phrasebook pin apply the SAME rule, from the same
 * constant, so no path can mint an unanswerable card.
 */
export function generateCards(db: Db): number {
  const findings = db
    .prepare(
      `SELECT f.id, f.session_id, f.quote, f.correction, f.explanation, f.category, f.start_ms
         FROM findings f
        WHERE ${INCLUDED_FINDING_SCOPE}
          AND ${CARDABLE_CATEGORY_SQL}
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.finding_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM deleted_findings d WHERE d.finding_id = f.id)`,
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

/**
 * The outcome of pinning a finding — three genuinely different answers the route must
 * be able to tell apart, which a bare `Card | null` could not.
 */
export type PinOutcome =
  | { status: "pinned"; card: Card }
  | { status: "not_found" }
  /** The finding cannot become an answerable card; it belongs to another surface. */
  | { status: "not_cardable"; category: string };

/**
 * Pin one finding into the deck (E-9): ensure a card exists for it, deliberately
 * clearing any `deleted_findings` tombstone first — so a finding the user removed
 * from their deck (E-5b) can be added back on purpose. Idempotent: the
 * `finding_id` UNIQUE key + INSERT OR IGNORE means a second pin is a no-op and the
 * existing card (with its live schedule) is untouched — no duplicate. This is the ONLY
 * seam that un-tombstones; the bulk `generateCards` still skips tombstoned findings.
 *
 * [E-37] An UNCARDABLE finding is refused here, not just in bulk generation. Honouring
 * an explicit user act is the right instinct, but a pronunciation finding's spelling was
 * never wrong, so `deriveFront` has no localized change to cue from and degrades to a
 * bare "____ · pronunciation" — a card that cannot be answered. Minting it on request
 * does not make it work; it just means we broke it because the user asked. The pin route
 * sends these to the studio instead, which is the surface that can actually drill them.
 *
 * [E-39 §B6] This read used to be a bare `SELECT … FROM findings WHERE id = ?` with no
 * inclusion gate — the one user-triggerable write path that could act on a finding the
 * canonical scope hides (an `unreadable` segment's, or since §B1 another speaker's),
 * which also falsified `lib/findings-model.ts`'s claim that EVERY single-finding read
 * goes through it. It now applies `INCLUDED_FINDING_SCOPE`, the same fragment
 * `generateCards` 60 lines above already uses, so the scope is still decided in exactly
 * one place and an out-of-scope pin answers `not_found` — the same answer the Phrasebook
 * row it was reached from would give.
 */
export function pinFinding(db: Db, findingId: string): PinOutcome {
  return db.transaction((): PinOutcome => {
    const f = db
      .prepare(
        `SELECT f.id AS id, f.session_id AS session_id, f.quote AS quote, f.correction AS correction,
                f.explanation AS explanation, f.category AS category, f.start_ms AS start_ms
           FROM findings f WHERE f.id = ? AND ${INCLUDED_FINDING_SCOPE}`,
      )
      .get(findingId) as GeneratableFinding | undefined;
    if (!f) return { status: "not_found" };
    if (!isCardable(f.category)) return { status: "not_cardable", category: f.category };

    // A pin overrides a prior delete: drop the tombstone so the card returns.
    db.prepare("DELETE FROM deleted_findings WHERE finding_id = ?").run(findingId);
    db.prepare(
      `INSERT OR IGNORE INTO cards
         (id, finding_id, session_id, front, back, category, start_ms, ease, interval_days, repetitions, due, suspended)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), 0)`,
    ).run(
      randomUUID(),
      f.id,
      f.session_id,
      f.quote,
      cardBack(f.correction, f.explanation),
      f.category,
      f.start_ms,
      FRESH_EASE,
    );

    const row = db.prepare(`${SELECT_CARD} WHERE finding_id = ?`).get(findingId) as CardRow | undefined;
    return row ? { status: "pinned", card: toCard(row) } : { status: "not_found" };
  })();
}

/**
 * The pre-E-37 pin signature, kept for callers that only need "did a card result?".
 * An uncardable finding yields null here exactly as a missing one does — the route uses
 * `pinFinding` when it needs to tell those two apart.
 */
export function createCardForFinding(db: Db, findingId: string): Card | null {
  const outcome = pinFinding(db, findingId);
  return outcome.status === "pinned" ? outcome.card : null;
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

/**
 * Every card, for the browser (E-5b), soonest-due first and suspended-visible.
 * The order is a stable total order (`due` ASC, then `created_at`, then `id`) —
 * the same key `listDueCards` uses — so the list never reshuffles between reads.
 */
export function listCards(db: Db): Card[] {
  const rows = db
    .prepare(`${SELECT_CARD} ORDER BY due ASC, created_at ASC, id ASC`)
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
 * Grade a card: run the (now FSRS-6, E-25) scheduler over its current state and
 * persist the new ease/interval/repetitions, the grade, and a concrete `due`
 * derived from the interval (0 days = due now, so a lapsed card returns this
 * session). The drill is unchanged to the user — the scheduler shape and call
 * site are identical; only the algorithm behind `schedule` moved to FSRS.
 *
 * A graded review is also production evidence (D-19): when the card is linked to a
 * knowledge item (E-28 attaches one), the grade appends a cued review `evidence`
 * row — `again` → incorrect (polarity 0), every passing grade → correct (1). Cards
 * with no item link (all of them until E-28) simply log nothing yet. The append
 * and the schedule update commit together.
 */
export function gradeCard(db: Db, id: string, grade: Grade): Card {
  const card = getCard(db, id);
  if (!card) throw new Error(`No card ${id}.`);
  const next = schedule(
    { ease: card.ease, intervalDays: card.intervalDays, repetitions: card.repetitions },
    grade,
  );
  db.transaction(() => {
    db.prepare(
      `UPDATE cards
          SET ease = ?, interval_days = ?, repetitions = ?, last_grade = ?, due = datetime('now', ?)
        WHERE id = ?`,
    ).run(next.ease, next.intervalDays, next.repetitions, next.lastGrade, `+${next.intervalDays} days`, id);
    if (card.itemId) {
      recordEvidence(db, {
        itemId: card.itemId,
        source: "finding",
        sourceRef: card.findingId,
        polarity: grade === "again" ? 0 : 1,
        mode: "cued",
        audioDerived: false,
        sessionId: card.sessionId,
      });
    }
  })();
  return getCard(db, id)!;
}

/** Suspend or un-suspend a card. Returns whether a row changed. */
export function suspendCard(db: Db, id: string, suspended: boolean): boolean {
  return db.prepare("UPDATE cards SET suspended = ? WHERE id = ?").run(suspended ? 1 : 0, id).changes > 0;
}

/**
 * Delete a card and tombstone its finding so a later `generateCards` won't
 * resurrect it (the documented delete policy). Atomic: the tombstone and the
 * deletion commit together. Returns whether the card existed.
 */
export function deleteCard(db: Db, id: string): boolean {
  return db.transaction(() => {
    const row = db.prepare("SELECT finding_id FROM cards WHERE id = ?").get(id) as
      | { finding_id: string }
      | undefined;
    if (!row) return false;
    db.prepare("INSERT OR IGNORE INTO deleted_findings (finding_id) VALUES (?)").run(row.finding_id);
    db.prepare("DELETE FROM cards WHERE id = ?").run(id);
    return true;
  })();
}
