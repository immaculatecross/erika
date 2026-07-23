import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import {
  monthKey,
  monthToDateSpend,
  recordSpend,
  wouldExceedBudget,
  reserveSpend,
  finalizeReservation,
  releaseReservation,
  sweepStaleReservations,
} from "@/lib/analysis/budget";

// Criterion 7 — the spend ledger: N billable calls make N rows summing to the
// month-to-date total. Criterion 6 (cap logic, unit half) — wouldExceedBudget is
// a hard, truthful gate: equal-to-budget is allowed, a cent over is not.
//
// E-27 — reserve-before-call: the cap counts committed + pending, atomically, so a
// racing pool can never overshoot; a reservation is display-invisible (committed
// only) until finalized; abandoned reservations are swept.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-budget-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("spend ledger", () => {
  it("records one row per billable call and sums the month to date", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 0.01 });
    recordSpend(db, { model: "gpt-audio-1.5", contentHash: "a", costUsd: 0.2 });
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "b", costUsd: 0.01 });
    const rows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number };
    expect(rows.n).toBe(3);
    expect(monthToDateSpend(db)).toBeCloseTo(0.22, 10);
    db.close();
  });

  it("buckets spend by calendar month and ignores other months", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 1 }, new Date("2026-05-10T00:00:00Z"));
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "b", costUsd: 2 }, new Date("2026-06-10T00:00:00Z"));
    expect(monthToDateSpend(db, "2026-05")).toBe(1);
    expect(monthToDateSpend(db, "2026-06")).toBe(2);
    expect(monthKey(new Date("2026-06-10T00:00:00Z"))).toBe("2026-06");
    db.close();
  });

  it("gates hard: allows reaching the cap, refuses exceeding it", () => {
    const db = freshDb();
    recordSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 9.9 });
    expect(wouldExceedBudget(db, 0.1, 10)).toBe(false); // 9.9 + 0.1 == 10, allowed
    expect(wouldExceedBudget(db, 0.11, 10)).toBe(true); // 10.01 > 10, refused
    db.close();
  });
});

describe("reserve-before-call lifecycle (E-27 criterion 2)", () => {
  const entry = { model: "gpt-audio-1.5" as const, contentHash: "h", costUsd: 0.06 };

  it("a reservation counts against the cap but NOT against the display total", () => {
    const db = freshDb();
    const r = reserveSpend(db, entry, 10);
    expect(r).not.toBeNull();
    // Display / committed-semantics guard: a reservation is not spent money.
    expect(monthToDateSpend(db)).toBe(0);
    expect(wouldExceedBudget(db, 0, 10)).toBe(false); // committed-only, unaffected
    // ...but the cap (committed + pending) sees it: a second reservation that would
    // push the SUM over is refused even though committed is still 0.
    expect(reserveSpend(db, { ...entry, costUsd: 9.95 }, 10)).toBeNull(); // 0.06 + 9.95 > 10
    db.close();
  });

  it("finalize flips pending → committed at the real cost, exactly once", () => {
    const db = freshDb();
    const r = reserveSpend(db, entry, 10)!;
    finalizeReservation(db, r, 0.06);
    expect(monthToDateSpend(db)).toBeCloseTo(0.06, 9);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='committed'").get() as { n: number };
    expect(rows.n).toBe(1); // one committed row for the one charge — none doubled
    db.close();
  });

  it("release drops the reservation — no charge, cap freed", () => {
    const db = freshDb();
    const r = reserveSpend(db, entry, 10)!;
    releaseReservation(db, r);
    expect(monthToDateSpend(db)).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
    // The freed room is reusable.
    expect(reserveSpend(db, { ...entry, costUsd: 10 }, 10)).not.toBeNull();
    db.close();
  });

  it("finalize NEVER loses a charge even if the pending row was swept out from under it", () => {
    const db = freshDb();
    const r = reserveSpend(db, entry, 10)!;
    // Simulate a sweep/crash that removed the pending row before finalize ran.
    db.prepare("DELETE FROM spend_ledger WHERE id = ?").run(r.id);
    finalizeReservation(db, r, 0.06);
    expect(monthToDateSpend(db)).toBeCloseTo(0.06, 9); // re-inserted as committed, not lost
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='committed'").get() as { n: number }).n).toBe(1);
    db.close();
  });
});

describe("concurrent reservations against a tight cap never overshoot (E-27 criterion 2 — the oracle)", () => {
  // Many racers reserve against a cap that fits exactly K. The check-and-insert is
  // one atomic transaction counting committed + pending, so exactly K are admitted —
  // the (K+1)-th sees the K held reservations and is refused. A non-atomic
  // check-then-insert would let two racers both read the same pre-state and both
  // pass; this asserts that cannot happen and the committed total never exceeds the
  // cap. This race — not a fixture — is the proof the money cap is hard (D-13).
  it("admits exactly what fits and the committed total never exceeds the cap", async () => {
    const db = freshDb();
    const CAP = 1.0;
    const COST = 0.1; // K = 10 fit
    const TASKS = 40;

    // Phase 1: everyone reserves and HOLDS (pending), so admission is limited purely
    // by the committed + pending accounting, not by any finalize having landed yet.
    const reservations = await Promise.all(
      Array.from({ length: TASKS }, async (_unused, i) => {
        await Promise.resolve(); // interleave the racers on the microtask queue
        return reserveSpend(db, { model: "gpt-audio-1.5", contentHash: `h${i}`, costUsd: COST }, CAP);
      }),
    );
    const admitted = reservations.filter((r): r is NonNullable<typeof r> => r !== null);
    expect(admitted).toHaveLength(10);

    // While only reserved, committed + pending is within the cap and display is 0.
    const held = (db.prepare("SELECT COALESCE(SUM(cost_usd),0) AS t FROM spend_ledger").get() as { t: number }).t;
    expect(held).toBeLessThanOrEqual(CAP + 1e-9);
    expect(monthToDateSpend(db)).toBe(0); // no reservation shows as spent money

    // Phase 2: finalize every winner → committed lands, still within the cap.
    for (const r of admitted) finalizeReservation(db, r, r.costUsd);
    expect(monthToDateSpend(db)).toBeLessThanOrEqual(CAP + 1e-9);
    expect(monthToDateSpend(db)).toBeCloseTo(10 * COST, 9);
    // Exactly one committed row per admitted charge — none lost, none doubled.
    expect((db.prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE state='committed'").get() as { n: number }).n).toBe(10);
    db.close();
  });
});

describe("startup sweep of abandoned reservations (E-27 criterion 3)", () => {
  it("releases a stale pending row and retains a fresh one, unblocking a new reserve", () => {
    const db = freshDb();
    const CAP = 0.1;
    const stale = reserveSpend(db, { model: "gpt-audio-mini", contentHash: "a", costUsd: 0.04 }, CAP)!;
    const fresh = reserveSpend(db, { model: "gpt-audio-mini", contentHash: "b", costUsd: 0.04 }, CAP)!;
    // Backdate the first reservation so it is older than the sweep TTL.
    db.prepare("UPDATE spend_ledger SET reserved_at = datetime('now','-30 minutes') WHERE id = ?").run(stale.id);

    // Before the sweep the two pending rows (0.08) leave no room for a third 0.04.
    expect(reserveSpend(db, { model: "gpt-audio-mini", contentHash: "c", costUsd: 0.04 }, CAP)).toBeNull();

    const swept = sweepStaleReservations(db); // default TTL 15 min
    expect(swept).toBe(1);
    // The fresh reservation survives; the stale one is gone.
    expect(db.prepare("SELECT id FROM spend_ledger WHERE state='pending'").all()).toEqual([{ id: fresh.id }]);
    // ...and its freed room now admits the reservation that was blocked.
    expect(reserveSpend(db, { model: "gpt-audio-mini", contentHash: "c", costUsd: 0.04 }, CAP)).not.toBeNull();
    db.close();
  });
});
