import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import type { BillableModelId } from "./rates";

// The spend ledger and the monthly budget cap (D-10, E-4) — the money-safety spine.
// Every *real* billable model call records its actual cost here with a month key;
// cached calls record nothing. Deliberately hash-keyed with no session FK: spend
// history survives a session delete, so deleting-and-re-running can never evade the
// cap.
//
// E-27 makes the cap hard *under concurrency*. When the per-segment cascade runs
// through a bounded pool, several calls race toward the same cap, so reading only
// *committed* spend before each call (correct when one call is ever in flight) can
// let two racers both pass and overshoot. The fix is reserve-before-call: a call
// atomically inserts a **pending** ledger row for its estimated cost — the cap
// counts committed **+ pending**, and the check-and-insert is one transaction so
// two racers can never both pass such that their sum exceeds the cap. On the call
// resolving the reservation is **finalized** to the actual cost (pending →
// committed); a no-charge failure **releases** it; a crash between reserve and
// finalize leaves a pending row that the startup sweep releases after a TTL.
//
// `monthToDateSpend`/`wouldExceedBudget` keep their **committed-only** semantics —
// they are the *display* number (Settings month-to-date) and the guard the other
// billers (E-6 lessons, E-21 renditions, E-23 ask) use; a reservation is never
// shown as spent money. Only the cascade's own cap check counts pending, via
// `reserveSpend`.

/** Calendar-month key 'YYYY-MM' (UTC) — the ledger's aggregation bucket. */
export function monthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/**
 * Total USD **committed** in `month` (default: the current month) — real charges
 * only. Pending reservations are deliberately excluded: this is the display total
 * and the committed-semantics guard, unchanged by E-27's reservation machinery.
 */
export function monthToDateSpend(db: Db, month: string = monthKey()): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE month = ? AND state = 'committed'")
    .get(month) as { total: number };
  return row.total;
}

/** Committed **+ pending** USD in `month` — what the cap counts (E-27). */
function committedPlusPending(db: Db, month: string): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE month = ?")
    .get(month) as { total: number };
  return row.total;
}

/**
 * Would billing `costUsd` now push this month's **committed** spend past
 * `budgetUsd`? The cap is hard: a call that would land committed spend strictly
 * above the budget is refused. Equal-to-budget is allowed (spend may reach the
 * cap, never exceed it). This is the committed-only guard the non-cascade billers
 * use; the cascade reserves through `reserveSpend`, which additionally counts
 * pending reservations so a racing pool cannot overshoot.
 */
export function wouldExceedBudget(db: Db, costUsd: number, budgetUsd: number): boolean {
  return monthToDateSpend(db) + costUsd > budgetUsd + 1e-9;
}

/** Record one real billable call's actual cost as a **committed** row. Returns the
 *  ledger row id. Used by the non-reservation billers (E-6/E-21/E-23) and by test
 *  fixtures; the racing cascade reserves-then-finalizes instead. */
export function recordSpend(
  db: Db,
  entry: { model: BillableModelId; contentHash: string; costUsd: number },
  date: Date = new Date(),
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state) VALUES (?, ?, ?, ?, ?, 'committed')",
  ).run(id, monthKey(date), entry.model, entry.contentHash, entry.costUsd);
  return id;
}

// ---- reserve-before-call (E-27) ------------------------------------------

/** A held reservation — enough to finalize it (even after a sweep) or release it. */
export interface SpendReservation {
  id: string;
  model: BillableModelId;
  contentHash: string;
  /** The reserved (estimated) cost. In this rates model the estimate equals the
   *  actual charge (both are `callCost` over the same audio-minutes), so finalizing
   *  to it can never raise committed spend above what the cap already admitted. */
  costUsd: number;
}

/**
 * How long a pending reservation may sit before the startup sweep concludes its
 * worker crashed between reserve and finalize and releases it. Sized like the job
 * lease (`JOB_LEASE_STALE_MS`, 15 min): a live reservation settles within one model
 * call (seconds), so this errs long — it never sweeps an in-flight call, it only
 * frees genuinely abandoned reservations so they stop counting against the cap.
 * Conservative and tunable (D-13); the atomicity tests, not this number, are the
 * oracle for the cap being hard.
 */
export const RESERVATION_STALE_MS = 15 * 60 * 1000;

/**
 * Atomically reserve `entry.costUsd` as a **pending** ledger row, IFF committed +
 * pending + this cost would not exceed `budgetUsd`. Returns the reservation, or
 * `null` when the cap refuses it.
 *
 * The check and the insert run in ONE transaction: better-sqlite3 executes it
 * synchronously and atomically, so two racing reservations cannot both read the
 * same pre-state and both pass — the second sees the first's pending row and is
 * refused if their sum would overshoot. This is what makes the cap hard with the
 * whole pool racing (E-27 criterion 2).
 */
export function reserveSpend(
  db: Db,
  entry: { model: BillableModelId; contentHash: string; costUsd: number },
  budgetUsd: number,
  date: Date = new Date(),
): SpendReservation | null {
  const month = monthKey(date);
  return db.transaction((): SpendReservation | null => {
    if (committedPlusPending(db, month) + entry.costUsd > budgetUsd + 1e-9) return null;
    const id = randomUUID();
    db.prepare(
      "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state, reserved_at) " +
        "VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))",
    ).run(id, month, entry.model, entry.contentHash, entry.costUsd);
    return { id, model: entry.model, contentHash: entry.contentHash, costUsd: entry.costUsd };
  })();
}

/**
 * Finalize a reservation: flip its pending row to **committed** at the actual cost
 * (default: the reserved cost, which equals the charge here). Meant to run inside
 * the same transaction as the findings + witness (E-4 criterion 5), so a resolved
 * call's charge and its completion record commit together or not at all.
 *
 * If the pending row is gone — the only way is a startup sweep that fired while
 * this call was somehow still in flight, which the conservative TTL makes
 * impossible in practice — a fresh committed row is inserted instead, so a real
 * charge is **never lost** (E-27: exactly one committed row per charge).
 */
export function finalizeReservation(db: Db, r: SpendReservation, actualCostUsd: number = r.costUsd): void {
  const res = db
    .prepare("UPDATE spend_ledger SET state = 'committed', cost_usd = ?, reserved_at = NULL WHERE id = ? AND state = 'pending'")
    .run(actualCostUsd, r.id);
  if (res.changes === 0) {
    db.prepare(
      "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state) VALUES (?, ?, ?, ?, ?, 'committed')",
    ).run(r.id, monthKey(), r.model, r.contentHash, actualCostUsd);
  }
}

/** Release a reservation (no charge): drop its pending row. A no-op if already
 *  finalized or swept. Idempotent — safe to call on any outcome that did not bill. */
export function releaseReservation(db: Db, r: SpendReservation | string): void {
  const id = typeof r === "string" ? r : r.id;
  db.prepare("DELETE FROM spend_ledger WHERE id = ? AND state = 'pending'").run(id);
}

/**
 * Release every pending reservation older than `ttlMs` — the startup sweep,
 * mirroring the job-lease reclaim (E-16) and the render/ask lease sweeps
 * (E-21/E-23). A reservation only outlives its call if the worker crashed between
 * reserve and finalize, so a stale pending row is abandoned money that must stop
 * counting against the cap. Committed rows are never touched (spend history is
 * permanent). Returns the number swept.
 */
export function sweepStaleReservations(db: Db, ttlMs: number = RESERVATION_STALE_MS): number {
  const cutoff = `-${Math.round(ttlMs / 1000)} seconds`;
  const res = db
    .prepare("DELETE FROM spend_ledger WHERE state = 'pending' AND reserved_at <= datetime('now', ?)")
    .run(cutoff);
  return res.changes;
}
