import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { monthToDateSpend, reserveSpend, sweepStaleReservations } from "@/lib/analysis/budget";
import { REALTIME_FLAGSHIP, REALTIME_MINI, realtimeSessionCost } from "@/lib/analysis/rates";
import {
  estimateTutorSessionUsd,
  openTutorLease,
  ensureTutorLeaseCovers,
  finalizeTutorLease,
  releaseTutorLease,
  tutorReservedUsd,
  tutorLeaseModel,
  tutorContentHash,
} from "@/lib/tutor/money";

// The realtime tutor's money spine (E-34, WO criterion 5): a per-session estimate,
// reserve/lease against the cap, heartbeat extension, finalize-to-actual clamped to
// the lease, truthful cap refusal, and — never-waivable — the ONE ledger under a HARD
// cross-biller cap (no forked money path). Every assertion here is an oracle for a
// long call never silently blowing the budget.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-money-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const FLAG = REALTIME_FLAGSHIP;

function pendingRows(db: Db, tutorId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
      .get(tutorContentHash(tutorId)) as { n: number }
  ).n;
}
function committedRows(db: Db, tutorId: string): { n: number; total: number } {
  return db
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'committed'")
    .get(tutorContentHash(tutorId)) as { n: number; total: number };
}

describe("tutor per-session estimate", () => {
  it("prices from the per-minute realtime rate and mini is cheaper than flagship", () => {
    expect(estimateTutorSessionUsd(FLAG, 10)).toBeCloseTo(realtimeSessionCost(FLAG, 10));
    expect(estimateTutorSessionUsd(FLAG, 10)).toBeGreaterThan(0);
    expect(estimateTutorSessionUsd(REALTIME_MINI, 10)).toBeLessThan(estimateTutorSessionUsd(FLAG, 10));
  });
});

describe("open lease + truthful cap refusal", () => {
  it("reserves the estimate as pending and records the lease model", () => {
    const db = freshDb();
    const lease = openTutorLease(db, "t1", FLAG, 10, 100);
    expect(lease).not.toBeNull();
    expect(pendingRows(db, "t1")).toBe(1);
    expect(tutorReservedUsd(db, "t1")).toBeCloseTo(estimateTutorSessionUsd(FLAG, 10));
    expect(tutorLeaseModel(db, "t1")).toBe(FLAG);
    // A reservation is not spent money: month-to-date (committed only) is still 0.
    expect(monthToDateSpend(db)).toBe(0);
    db.close();
  });

  it("refuses at the cap with NO reservation (no session opens, no token minted)", () => {
    const db = freshDb();
    expect(openTutorLease(db, "t2", FLAG, 10, 0)).toBeNull();
    expect(pendingRows(db, "t2")).toBe(0);
    db.close();
  });
});

describe("heartbeat extension keeps the cap hard on a long call", () => {
  it("is a no-op when the lease already covers the elapsed time", () => {
    const db = freshDb();
    openTutorLease(db, "t3", FLAG, 10, 100);
    const before = tutorReservedUsd(db, "t3");
    expect(ensureTutorLeaseCovers(db, "t3", FLAG, 8, 100)).toBe(true);
    expect(tutorReservedUsd(db, "t3")).toBeCloseTo(before); // no over-reservation
    db.close();
  });

  it("reserves the shortfall when the call outlasts the lease", () => {
    const db = freshDb();
    openTutorLease(db, "t4", FLAG, 10, 100);
    expect(ensureTutorLeaseCovers(db, "t4", FLAG, 20, 100)).toBe(true);
    expect(tutorReservedUsd(db, "t4")).toBeCloseTo(estimateTutorSessionUsd(FLAG, 20));
    db.close();
  });

  it("refuses the extension at the cap (the call cannot overshoot)", () => {
    const db = freshDb();
    const budget = estimateTutorSessionUsd(FLAG, 12); // room for 12 min only
    openTutorLease(db, "t5", FLAG, 10, budget);
    expect(ensureTutorLeaseCovers(db, "t5", FLAG, 20, budget)).toBe(false);
    // Reserved never exceeded the cap.
    expect(tutorReservedUsd(db, "t5")).toBeLessThanOrEqual(budget + 1e-9);
    db.close();
  });
});

describe("finalize-to-actual, clamped to the lease", () => {
  it("commits ONE row at the actual elapsed cost and drops the pending rows", () => {
    const db = freshDb();
    openTutorLease(db, "t6", FLAG, 10, 100);
    const committed = finalizeTutorLease(db, "t6", FLAG, 4);
    expect(committed).toBeCloseTo(estimateTutorSessionUsd(FLAG, 4));
    expect(pendingRows(db, "t6")).toBe(0);
    const c = committedRows(db, "t6");
    expect(c.n).toBe(1);
    expect(c.total).toBeCloseTo(estimateTutorSessionUsd(FLAG, 4));
    expect(monthToDateSpend(db)).toBeCloseTo(estimateTutorSessionUsd(FLAG, 4));
    db.close();
  });

  it("never commits more than was reserved (the lease can't be overshot)", () => {
    const db = freshDb();
    openTutorLease(db, "t7", FLAG, 10, 100);
    const committed = finalizeTutorLease(db, "t7", FLAG, 100); // claim a 100-min call
    expect(committed).toBeCloseTo(estimateTutorSessionUsd(FLAG, 10)); // clamped to the lease
    expect(committedRows(db, "t7").n).toBe(1);
    db.close();
  });
});

describe("release + the hard cross-biller cap", () => {
  it("release drops the pending rows and commits nothing", () => {
    const db = freshDb();
    openTutorLease(db, "t8", FLAG, 10, 100);
    releaseTutorLease(db, "t8");
    expect(pendingRows(db, "t8")).toBe(0);
    expect(monthToDateSpend(db)).toBe(0);
    db.close();
  });

  it("an open tutor lease holds the cap against every other biller (cross-biller hard)", () => {
    const db = freshDb();
    const budget = estimateTutorSessionUsd(FLAG, 10);
    openTutorLease(db, "t9", FLAG, 10, budget); // reserves the whole cap
    // Any other biller reserving even a cent now must be refused — the tutor's
    // pending lease counts against committed+pending (E-27), so the cap stays hard.
    const other = reserveSpend(db, { model: "gpt-4.1-mini", contentHash: "other", costUsd: 0.01 }, budget);
    expect(other).toBeNull();
    db.close();
  });

  it("a stale tutor lease is reclaimed by the existing startup sweep", () => {
    const db = freshDb();
    openTutorLease(db, "t10", FLAG, 10, 100);
    // Backdate the reservation past the TTL, then sweep.
    db.prepare("UPDATE spend_ledger SET reserved_at = datetime('now','-30 minutes') WHERE content_hash = ?").run(
      tutorContentHash("t10"),
    );
    expect(sweepStaleReservations(db)).toBeGreaterThanOrEqual(1);
    expect(pendingRows(db, "t10")).toBe(0);
    db.close();
  });
});
