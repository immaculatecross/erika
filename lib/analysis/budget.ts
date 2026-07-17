import { randomUUID } from "node:crypto";
import type { Db } from "../db";
import type { ModelId } from "./rates";

// The spend ledger and the monthly budget cap (D-10) — the money-safety spine of
// E-4. Every *real* billable model call records its actual cost here with a month
// key; cached calls record nothing. Before each billable call the cascade asks
// `wouldExceedBudget` whether month-to-date spend plus this call's cost crosses
// the Settings cap, and halts truthfully if so — it never bills over the cap.
// Deliberately hash-keyed with no session FK: spend history survives a session
// delete, so deleting-and-re-running can never evade the cap.

/** Calendar-month key 'YYYY-MM' (UTC) — the ledger's aggregation bucket. */
export function monthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Total USD billed in `month` (default: the current month). */
export function monthToDateSpend(db: Db, month: string = monthKey()): number {
  const row = db
    .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM spend_ledger WHERE month = ?")
    .get(month) as { total: number };
  return row.total;
}

/**
 * Would billing `costUsd` now push this month's spend past `budgetUsd`? The cap
 * is hard: a call that would land month-to-date strictly above the budget is
 * refused. Equal-to-budget is allowed (spend may reach the cap, never exceed it).
 */
export function wouldExceedBudget(db: Db, costUsd: number, budgetUsd: number): boolean {
  return monthToDateSpend(db) + costUsd > budgetUsd + 1e-9;
}

/** Record one real billable call's actual cost. Returns the ledger row id. */
export function recordSpend(
  db: Db,
  entry: { model: ModelId; contentHash: string; costUsd: number },
  date: Date = new Date(),
): string {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd) VALUES (?, ?, ?, ?, ?)",
  ).run(id, monthKey(date), entry.model, entry.contentHash, entry.costUsd);
  return id;
}
