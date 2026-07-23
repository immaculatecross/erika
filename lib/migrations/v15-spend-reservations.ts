import type { Migration } from "./index";

// E-27 Parallel cascade & spend reservations (D-10, D-15): the spend ledger gains
// a reservation state so the budget cap stays hard when the per-segment cascade
// runs through a bounded concurrency pool.
//
// `spend_ledger.state` — 'pending' while a call's estimated cost is reserved
//   before it fires, 'committed' once the call resolves and the real charge is
//   finalized (or for any directly-recorded charge). The cap counts committed +
//   pending; the display total (`monthToDateSpend`) counts committed only.
//   DEFAULT 'committed' so every pre-v15 row — all of them real, finalized charges
//   — reads exactly as it did before. Additive and shipped-once.
// `spend_ledger.reserved_at` — when a pending reservation was created, so the
//   startup sweep (`sweepStaleReservations`) can release reservations a crashed
//   worker abandoned between reserve and finalize. NULL on committed rows.
//
// `idx_spend_ledger_pending` indexes the sweep's scan (pending rows by age).
export const spendReservationsMigration: Migration = {
  version: 15,
  name: "spend_reservations",
  up: (db) => {
    db.exec(`
      ALTER TABLE spend_ledger ADD COLUMN state TEXT NOT NULL DEFAULT 'committed'
        CHECK (state IN ('pending', 'committed'));
      ALTER TABLE spend_ledger ADD COLUMN reserved_at TEXT;
      CREATE INDEX idx_spend_ledger_pending ON spend_ledger(state, reserved_at);
    `);
  },
};
