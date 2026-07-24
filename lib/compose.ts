import type { Db } from "./db";
import { INCLUDED_FINDING_SCOPE } from "./findings-model";
import { retrievability, seedStability } from "./srs";
import { materializeSlips, listSlips } from "./slips";
import { nextLocalDay } from "./local-day";
import type { KnowledgeStatus } from "./knowledge";

// The daily composer (E-31, D-19). `compose(day)` builds the learner's plan for a
// local day from THEIR OWN recorded material first, making ZERO model calls — it is
// the knowledge core's first production reader. The composition itself is a PURE
// function (`composePlan`) over plain candidate lists, unit-tested against
// hand-built fixtures; the DB glue below gathers those lists (due reviews, active
// slips, unspent findings, and new items at the knowledge edge) and, in one
// transaction, drains the spill queue and writes tomorrow's overflow back to it.
//
// PRIORITY ORDER (WO criterion 1): spill queue (yesterday's overflow) → FSRS-due
// reviews (worst retrievability first) → active slips → unspent findings → new
// items at the knowledge edge (10 vocab / 3 rules / 10 pronunciation by default,
// settable). New items of different kinds are interleaved (round-robin) rather than
// blocked. A day has a total capacity (`dailyMax`); anything beyond it that is a
// NEW ITEM spills to tomorrow (spill_queue holds knowledge items only — reviews,
// slips and findings that don't fit are simply recomputed tomorrow, still due /
// active / unspent, so they need no persistence).
//
// SPILL LIFECYCLE (idempotent). Drained spill rows (planned_for ≤ day) are the
// day's first, highest-priority new items; they PERSIST until their item leaves
// `unseen` (an evidence write, E-32) — at which point compose deletes the stale row
// (self-healing). Only FRESH-sourced overflow is written forward: compose rewrites
// the `planned_for = nextDay` rows each run (delete-all + reinsert), so running it
// many times a day converges to the same queue and the plan is stable. Nothing
// here touches money, and the whole read is a fixed number of statements.

export type NewKind = "vocab" | "rule" | "pronunciation";
export type PlanItemKind = "review" | "slip" | "finding" | NewKind;

/** The kinds a new item can be, in the fixed round-robin interleave order. */
export const NEW_KINDS: readonly NewKind[] = ["vocab", "rule", "pronunciation"];

/** knowledge_items.kind → the composer's new-item kind. */
export function newKindOf(itemKind: "lemma" | "rule" | "phone"): NewKind {
  return itemKind === "lemma" ? "vocab" : itemKind === "rule" ? "rule" : "pronunciation";
}

/** Per-day caps. The three new-item caps are settable (Settings); `dailyMax` is the
 *  total-items ceiling whose pressure spills new items to tomorrow. */
export interface ComposeCaps {
  newVocab: number;
  newRules: number;
  newPron: number;
  dailyMax: number;
}

export const DEFAULT_CAPS: ComposeCaps = { newVocab: 10, newRules: 3, newPron: 10, dailyMax: 40 };

/** A grammar-rule prereq counts as satisfied once the user has REAL (non-recognition)
 *  evidence on it — it is being learned, known, or was (lapsed). Recognition-only
 *  (`introduced`) is not production and does not unlock a dependent rule (D-19). */
export const PREREQ_SATISFIED: ReadonlySet<KnowledgeStatus> = new Set<KnowledgeStatus>([
  "learning",
  "known",
  "lapsed",
]);

// ── pure-core candidate shapes ───────────────────────────────────────────────

export interface ReviewCandidate {
  cardId: string;
  itemId: string | null;
  /** FSRS retrievability R(t,S) ∈ [0,1] — lower is more urgent. */
  retrievability: number;
}
export interface SlipCandidate {
  slipId: string;
}
export interface FindingCandidate {
  findingId: string;
}
export interface NewItemCandidate {
  itemId: string;
  kind: NewKind;
}
export interface SpillCandidate {
  itemId: string;
  kind: NewKind;
}

export interface ComposeInput {
  day: string;
  nextDay: string;
  /** Drained spill (planned_for ≤ day), eligible, oldest-first. */
  spill: SpillCandidate[];
  /** Due reviews, already sorted worst-retrievability first. */
  reviews: ReviewCandidate[];
  /** Active slips, in display order. */
  slips: SlipCandidate[];
  /** Unspent findings, newest-first. */
  findings: FindingCandidate[];
  /** Fresh edge items per kind, already filtered (unseen, not attested, DAG-ok) and
   *  ordered (vocab by freq_rank, rules by CEFR, pronunciation by suspect order). */
  fresh: Record<NewKind, NewItemCandidate[]>;
  caps: ComposeCaps;
}

// ── plan output ──────────────────────────────────────────────────────────────

export interface PlanItem {
  kind: PlanItemKind;
  /** cardId | slipId | findingId | knowledge-item id. */
  ref: string;
  /** The knowledge item this row is evidence-bearing for (new items, linked
   *  reviews), else null. */
  itemId: string | null;
  source: "spill" | "fresh" | "due" | "active" | "unspent";
}

/** A knowledge item to (re)queue for a future day. */
export interface SpillWrite {
  itemId: string;
  plannedFor: string;
}

export interface ComposedPlan {
  day: string;
  /** Served today, in display order, ≤ dailyMax. */
  items: PlanItem[];
  /** Fresh-sourced new items that overflowed today's capacity → queued for nextDay. */
  spillForward: SpillWrite[];
  counts: Record<PlanItemKind, number>;
}

/** Round-robin the per-kind lists into one list, in NEW_KINDS order. */
function interleaveKinds(byKind: Record<NewKind, NewItemCandidate[]>): NewItemCandidate[] {
  const out: NewItemCandidate[] = [];
  const max = Math.max(...NEW_KINDS.map((k) => byKind[k].length), 0);
  for (let i = 0; i < max; i++) {
    for (const k of NEW_KINDS) {
      const item = byKind[k][i];
      if (item) out.push(item);
    }
  }
  return out;
}

const cap = (kind: NewKind, caps: ComposeCaps): number =>
  kind === "vocab" ? caps.newVocab : kind === "rule" ? caps.newRules : caps.newPron;

/**
 * The pure composition. Deterministic given the input; no I/O. Builds the day's
 * new-item slate per kind (spill first, then fresh, capped), assembles the whole
 * plan in priority order with new items interleaved, truncates to `dailyMax`, and
 * reports the fresh-sourced overflow to carry to tomorrow.
 */
export function composePlan(input: ComposeInput): ComposedPlan {
  const { caps } = input;

  // Per-kind new-item slate: spill-sourced first (they have waited), then fresh, up
  // to the kind's cap. Track the source so overflow spills only FRESH items.
  const spillSelected: Record<NewKind, NewItemCandidate[]> = { vocab: [], rule: [], pronunciation: [] };
  const freshSelected: Record<NewKind, NewItemCandidate[]> = { vocab: [], rule: [], pronunciation: [] };
  for (const k of NEW_KINDS) {
    const spK = input.spill.filter((s) => s.kind === k);
    const frK = input.fresh[k];
    const budget = cap(k, caps);
    const fromSpill = spK.slice(0, budget).map((s) => ({ itemId: s.itemId, kind: k }));
    const fromFresh = frK.slice(0, Math.max(0, budget - fromSpill.length));
    spillSelected[k] = fromSpill;
    freshSelected[k] = fromFresh;
  }

  const spillNew = interleaveKinds(spillSelected);
  const freshNew = interleaveKinds(freshSelected);

  // Assemble in priority order.
  const assembled: PlanItem[] = [
    ...spillNew.map((n): PlanItem => ({ kind: n.kind, ref: n.itemId, itemId: n.itemId, source: "spill" })),
    ...input.reviews.map((r): PlanItem => ({ kind: "review", ref: r.cardId, itemId: r.itemId, source: "due" })),
    ...input.slips.map((s): PlanItem => ({ kind: "slip", ref: s.slipId, itemId: null, source: "active" })),
    ...input.findings.map((f): PlanItem => ({ kind: "finding", ref: f.findingId, itemId: null, source: "unspent" })),
    ...freshNew.map((n): PlanItem => ({ kind: n.kind, ref: n.itemId, itemId: n.itemId, source: "fresh" })),
  ];

  const served = assembled.slice(0, caps.dailyMax);
  const overflow = assembled.slice(caps.dailyMax);

  // Only FRESH-sourced new items in the overflow spill forward; drained spill items
  // keep their existing (planned_for ≤ day) rows and are handled by the glue.
  const spillForward: SpillWrite[] = overflow
    .filter((it) => it.source === "fresh")
    .map((it) => ({ itemId: it.ref, plannedFor: input.nextDay }));

  const counts: Record<PlanItemKind, number> = {
    review: 0, slip: 0, finding: 0, vocab: 0, rule: 0, pronunciation: 0,
  };
  for (const it of served) counts[it.kind] += 1;

  return { day: input.day, items: served, spillForward, counts };
}

// ── DB glue ──────────────────────────────────────────────────────────────────

interface SpillRow { item_id: string; kind: "lemma" | "rule" | "phone"; status: KnowledgeStatus; recording_attested: number; }

/** Drained spill (planned_for ≤ day), joined to its item's live status, oldest-first. */
function readSpill(db: Db, day: string): SpillRow[] {
  return db
    .prepare(
      `SELECT sq.item_id AS item_id, ki.kind AS kind, ki.status AS status, ki.recording_attested AS recording_attested
         FROM spill_queue sq
         JOIN knowledge_items ki ON ki.id = sq.item_id
        WHERE sq.planned_for <= ?
        ORDER BY sq.planned_for, sq.created_at, sq.id`,
    )
    .all(day) as SpillRow[];
}

/** A drained spill item is still eligible while it is `unseen`, not attested, and
 *  (for rules) its prereqs stay satisfied. Otherwise its row is stale → deleted. */
function spillItemEligible(row: SpillRow, ruleEligible: (id: string) => boolean): boolean {
  if (row.status !== "unseen" || row.recording_attested) return false;
  if (row.kind === "rule") return ruleEligible(row.item_id);
  return true;
}

interface ReviewRow { id: string; item_id: string | null; interval_days: number; due: string; }

/** Due, non-suspended cards the user has seen before (repetitions > 0) become
 *  reviews, sorted worst-retrievability first. A never-graded fresh card is NOT a
 *  review — its finding is surfaced as unspent material instead (no double-count). */
function readReviews(db: Db, day: string): ReviewCandidate[] {
  const rows = db
    .prepare(
      `SELECT id, item_id, interval_days, due
         FROM cards
        WHERE suspended = 0 AND repetitions > 0 AND due <= datetime('now')`,
    )
    .all() as ReviewRow[];
  const nowMs = Date.now();
  const withR = rows.map((r) => {
    const dueMs = Date.parse(r.due.replace(" ", "T") + "Z");
    const lastReviewMs = dueMs - r.interval_days * 86_400_000;
    const elapsedDays = Math.max(0, (nowMs - lastReviewMs) / 86_400_000);
    return {
      cardId: r.id,
      itemId: r.item_id,
      retrievability: retrievability(seedStability(r.interval_days), elapsedDays),
    };
  });
  // Worst (lowest) retrievability first; stable tiebreak by card id.
  withR.sort((a, b) => a.retrievability - b.retrievability || (a.cardId < b.cardId ? -1 : 1));
  return withR;
}

/** Included, non-tombstoned findings the user has never drilled (no graded or
 *  suspended card) — fresh corrections from their own speech, newest first. */
function readUnspentFindings(db: Db): FindingCandidate[] {
  const rows = db
    .prepare(
      `SELECT f.id AS id
         FROM findings f
        WHERE ${INCLUDED_FINDING_SCOPE}
          AND NOT EXISTS (SELECT 1 FROM deleted_findings d WHERE d.finding_id = f.id)
          AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.finding_id = f.id AND (c.repetitions > 0 OR c.suspended = 1))
        ORDER BY f.created_at DESC, f.id`,
    )
    .all() as { id: string }[];
  return rows.map((r) => ({ findingId: r.id }));
}

/** Active slips (materialize first, like every slip read route). */
function readActiveSlips(db: Db): SlipCandidate[] {
  materializeSlips(db);
  return listSlips(db)
    .filter((s) => s.standing.state === "active")
    .map((s) => ({ slipId: s.id }));
}

const CEFR_ORDER: Record<string, number> = { A1: 0, A2: 1, B1: 2, B2: 3, C1: 4, C2: 5 };

interface RuleItemRow { id: string; status: KnowledgeStatus; prereqs: string | null; cefr: string | null; }

/** Fresh new items per kind at the knowledge edge, excluding anything already
 *  queued in spill_queue, already `known`, or recording-attested (WO criterion 2). */
function readFresh(db: Db, day: string, caps: ComposeCaps): { fresh: Record<NewKind, NewItemCandidate[]>; ruleEligible: (id: string) => boolean } {
  // A rule's eligibility depends on every prereq's status — read the whole rule
  // inventory once and expose a predicate the spill-eligibility check reuses.
  const ruleRows = db
    .prepare("SELECT id, status, prereqs, cefr FROM knowledge_items WHERE kind = 'rule'")
    .all() as RuleItemRow[];
  const statusById = new Map(ruleRows.map((r) => [r.id, r.status]));
  const ruleEligible = (id: string): boolean => {
    const r = ruleRows.find((x) => x.id === id);
    if (!r) return false;
    const prereqs = r.prereqs ? (JSON.parse(r.prereqs) as string[]) : [];
    return prereqs.every((p) => PREREQ_SATISFIED.has(statusById.get(p) ?? "unseen"));
  };

  // Exclude only PERSISTENT drained spill (planned_for ≤ day) from fresh selection:
  // those items are offered via the spill path. Tomorrow's tentative overflow rows
  // (planned_for = nextDay) are deliberately NOT excluded — the glue rewrites them
  // each run, so excluding them would shift the fresh set and break same-day
  // idempotency (a re-run would pick different items and re-spill different ones).
  const spilled = new Set(
    (db.prepare("SELECT DISTINCT item_id FROM spill_queue WHERE planned_for <= ?").all(day) as { item_id: string }[]).map(
      (r) => r.item_id,
    ),
  );

  // Vocab: most-frequent unseen lemma first.
  const vocab = (
    db
      .prepare(
        `SELECT id FROM knowledge_items
          WHERE kind = 'lemma' AND status = 'unseen' AND recording_attested = 0 AND freq_rank IS NOT NULL
          ORDER BY freq_rank ASC`,
      )
      .all() as { id: string }[]
  )
    .filter((r) => !spilled.has(r.id))
    .slice(0, caps.newVocab)
    .map((r): NewItemCandidate => ({ itemId: r.id, kind: "vocab" }));

  // Rules: unseen, DAG-eligible, ordered by CEFR then id.
  const rule = ruleRows
    .filter((r) => r.status === "unseen" && !spilled.has(r.id) && ruleEligible(r.id))
    .sort((a, b) => (CEFR_ORDER[a.cefr ?? ""] ?? 9) - (CEFR_ORDER[b.cefr ?? ""] ?? 9) || (a.id < b.id ? -1 : 1))
    .slice(0, caps.newRules)
    .map((r): NewItemCandidate => ({ itemId: r.id, kind: "rule" }));

  // Pronunciation: unseen phones at the edge (seeded by E-37; empty until then).
  const pronunciation = (
    db
      .prepare(
        `SELECT id FROM knowledge_items
          WHERE kind = 'phone' AND status = 'unseen' AND recording_attested = 0
          ORDER BY freq_rank IS NULL, freq_rank ASC, id`,
      )
      .all() as { id: string }[]
  )
    .filter((r) => !spilled.has(r.id))
    .slice(0, caps.newPron)
    .map((r): NewItemCandidate => ({ itemId: r.id, kind: "pronunciation" }));

  return { fresh: { vocab, rule, pronunciation }, ruleEligible };
}

/**
 * Compose the plan for `day` and reconcile the spill queue. Reads a fixed number of
 * statements, makes ZERO model calls, and writes only the spill queue (never money,
 * never findings, never evidence). Idempotent within a day. Returns the plan.
 */
export function compose(db: Db, day: string, caps: ComposeCaps = DEFAULT_CAPS): ComposedPlan {
  const nextDay = nextLocalDay(day);

  const { fresh, ruleEligible } = readFresh(db, day, caps);
  const spillRows = readSpill(db, day);
  const eligibleSpill: SpillCandidate[] = [];
  const staleSpillIds: string[] = [];
  for (const row of spillRows) {
    if (spillItemEligible(row, ruleEligible)) {
      eligibleSpill.push({ itemId: row.item_id, kind: newKindOf(row.kind) });
    } else {
      staleSpillIds.push(row.item_id);
    }
  }

  const plan = composePlan({
    day,
    nextDay,
    spill: eligibleSpill,
    reviews: readReviews(db, day),
    slips: readActiveSlips(db),
    findings: readUnspentFindings(db),
    fresh,
    caps,
  });

  // Reconcile spill_queue idempotently: drop stale (learned) drained rows, rewrite
  // tomorrow's fresh-overflow set (delete-all + reinsert). Drained rows that were
  // served or overflowed keep their planned_for ≤ day rows and re-drain until learned.
  const tx = db.transaction(() => {
    if (staleSpillIds.length > 0) {
      const del = db.prepare("DELETE FROM spill_queue WHERE item_id = ? AND planned_for <= ?");
      for (const id of staleSpillIds) del.run(id, day);
    }
    db.prepare("DELETE FROM spill_queue WHERE planned_for = ?").run(nextDay);
    const ins = db.prepare(
      "INSERT INTO spill_queue (id, item_id, planned_for) VALUES (lower(hex(randomblob(16))), ?, ?)",
    );
    for (const s of plan.spillForward) ins.run(s.itemId, s.plannedFor);
  });
  tx();

  return plan;
}
