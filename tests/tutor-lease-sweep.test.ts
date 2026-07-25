import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import {
  ASSUMED_RUN_PREFIXES,
  ASSUMED_RUN_SQL,
  RESERVATION_STALE_MS,
  isAssumedRunLeaseHash,
  monthToDateSpend,
  sweepStaleReservations,
} from "@/lib/analysis/budget";
import { REALTIME_FLAGSHIP } from "@/lib/analysis/rates";
import {
  ensureTutorLeaseCovers,
  finalizeTutorLease,
  maxTutorSessionMinutes,
  touchTutorLease,
  tutorContentHash,
  tutorLeaseOpenedAtMs,
  tutorReservedUsd,
} from "@/lib/tutor/money";

// THE 1.9× STALE-LEASE OVERBILL (RETRO-004 §2, D-28, E-43 criterion 19).
//
// A LEGAL 21-minute tutor call billed 1.9× — probed $1.584 → $3.024 — because
// `RESERVATION_STALE_MS` (15 min) is shorter than `maxTutorSessionMinutes()` (30 min)
// and the sweep runs at the top of every analysis job. Mid-call it found the lease's
// OLDEST rows past the cutoff and the recent ones not, committed the old half, and
// left the live half to be finalized again by `/end`. It also moved the lease's
// apparent start forward (`tutorLeaseOpenedAtMs` reads MIN over PENDING rows), which
// reset server-elapsed 20.0 → 0.0 min and disabled BOTH the duration ceiling and the
// under-report floor.
//
// ⚠️ WHY NO TEST CAUGHT IT, AND WHAT THAT DEMANDS OF THIS ONE. The existing suite's
// `ageLease` helper is a BLANKET UPDATE over a lease's rows, so it could not produce a
// MIXED-AGE lease — the only state in which the bug exists. A fixture that cannot
// express the failure cannot test the fix. So this file builds leases row by row with
// explicit per-row `reserved_at` values, and the first test asserts the fixture really
// is mixed-age before asserting anything about behaviour.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-lease-sweep-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** Insert one pending row for `hash`, reserved `minutesAgo` minutes ago. */
function reserveAt(db: Db, hash: string, costUsd: number, minutesAgo: number): void {
  db.prepare(
    "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state, reserved_at) " +
      "VALUES (?, strftime('%Y-%m','now'), ?, ?, ?, 'pending', datetime('now', ?))",
  ).run(randomUUID(), REALTIME_FLAGSHIP, hash, costUsd, `-${Math.round(minutesAgo * 60)} seconds`);
}

/**
 * The exact shape RETRO-004 measured: a 21-minute call whose lease was opened at
 * minute 0 and extended by heartbeat every minute since. At minute 21 with a 15-minute
 * TTL, rows from minutes 0–6 are past the cutoff and rows from minutes 7–21 are not.
 */
function liveTwentyOneMinuteLease(db: Db, tutorId: string): number {
  const hash = tutorContentHash(tutorId);
  let total = 0;
  for (let minute = 0; minute <= 21; minute += 1) {
    const cost = minute === 0 ? 0.5 : 0.05;
    reserveAt(db, hash, cost, 21 - minute);
    total += cost;
  }
  return total;
}

function committed(db: Db, hash: string): { n: number; total: number } {
  return db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'committed'",
    )
    .get(hash) as { n: number; total: number };
}

describe("the fixture can express the failure", () => {
  it("builds a genuinely MIXED-AGE lease — some rows past the TTL, some not", () => {
    const db = freshDb();
    liveTwentyOneMinuteLease(db, "t");
    const cutoffMinutes = RESERVATION_STALE_MS / 60_000;
    const rows = db
      .prepare("SELECT reserved_at FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
      .all(tutorContentHash("t")) as { reserved_at: string }[];
    const stale = rows.filter(
      (r) => (Date.now() - new Date(`${r.reserved_at.replace(" ", "T")}Z`).getTime()) / 60_000 > cutoffMinutes,
    );
    expect(stale.length).toBeGreaterThan(0); // the old half
    expect(stale.length).toBeLessThan(rows.length); // and the live half
    db.close();
  });

  it("the conditions that produced the defect are still present in the code", () => {
    // The fix must not depend on the TTL happening to exceed the session ceiling. If
    // someone "fixes" it by moving one of these numbers, this assertion says so.
    expect(RESERVATION_STALE_MS / 60_000).toBeLessThan(maxTutorSessionMinutes());
  });
});

describe("a live tutor lease survives the sweep whole", () => {
  it("is NOT swept while it is still being extended", () => {
    const db = freshDb();
    const reserved = liveTwentyOneMinuteLease(db, "live");
    expect(sweepStaleReservations(db)).toBe(0);
    expect(tutorReservedUsd(db, "live")).toBeCloseTo(reserved, 9);
    expect(monthToDateSpend(db)).toBe(0);
    db.close();
  });

  it("keeps the lease's OPEN instant intact, so the duration ceiling still works", () => {
    // The second half of the defect: a partial sweep moved MIN(reserved_at) forward,
    // resetting server-elapsed to ~0 and switching off both the [T2b] ceiling and the
    // [T2c] under-report floor at once.
    const db = freshDb();
    liveTwentyOneMinuteLease(db, "live");
    const before = tutorLeaseOpenedAtMs(db, "live");
    sweepStaleReservations(db);
    const after = tutorLeaseOpenedAtMs(db, "live");
    expect(after).toBe(before);
    expect((Date.now() - (after as number)) / 60_000).toBeGreaterThan(20);
    db.close();
  });

  it("bills a legal 21-minute call ONCE — the 1.9× is gone", () => {
    const db = freshDb();
    const reserved = liveTwentyOneMinuteLease(db, "live");
    // The sweep fires mid-call, as it does at the top of every analysis job…
    sweepStaleReservations(db);
    // …and then the call ends normally.
    const billed = finalizeTutorLease(db, "live", REALTIME_FLAGSHIP, 21);
    const rows = committed(db, tutorContentHash("live"));
    expect(rows.n).toBe(1);
    expect(rows.total).toBeCloseTo(billed, 9);
    expect(billed).toBeLessThanOrEqual(reserved + 1e-9);
    // The honest single charge, not 1.9× of it.
    expect(monthToDateSpend(db)).toBeLessThanOrEqual(reserved + 1e-9);
    db.close();
  });
});

describe("a live lease that is NOT extending is still unreachable by the sweep", () => {
  // 🚩 THE HOLE THE FIX ABOVE LEFT, AND THE COMMENT THAT ASSERTED IT WAS CLOSED.
  //
  // `budget.ts` claimed "a live call reserves again on each minute it outlasts, so the
  // sweep cannot touch a live session at any TTL." The premise is false:
  // `ensureTutorLeaseCovers` inserts NOTHING while the call is still inside what was
  // reserved at OPEN. So for the first `defaultTutorMinutes()` minutes a lease has
  // exactly ONE row, and the claim held only because that default (10) happens to be
  // smaller than RESERVATION_STALE_MS (15). Nothing related those two numbers.
  //
  // It stopped being theoretical twice over: the operator raised the minimum
  // conversation to TEN MINUTES, so talking past the reservation is now the norm, and
  // `TUTOR_SESSION_MINUTES` is an env knob anyone may raise.
  //
  // The fixture is the honest one — a single OPEN row and no extensions — which is
  // exactly what the existing `liveTwentyOneMinuteLease` helper cannot express, since
  // it writes a row every minute and so can never be stale.

  /** A live call that reserved `reservedMinutes` at open and is now `ageMinutes` in,
   *  having never needed an extension. One row, as the real code produces. */
  function liveUnextendedLease(db: Db, tutorId: string, ageMinutes: number): number {
    const cost = 1.6;
    reserveAt(db, tutorContentHash(tutorId), cost, ageMinutes);
    return cost;
  }

  it("the fixture can express the failure: without a keep-alive it IS swept mid-call", () => {
    // Ground truth first — if this does not fail, the guard below proves nothing.
    const db = freshDb();
    const reserved = liveUnextendedLease(db, "live", RESERVATION_STALE_MS / 60_000 + 1);
    expect(sweepStaleReservations(db)).toBe(1);
    expect(monthToDateSpend(db)).toBeCloseTo(reserved, 9);
    // …and the live call is now cut off: nothing is reserved, so the next heartbeat
    // must buy coverage again or the learner is refused mid-sentence.
    expect(tutorReservedUsd(db, "live")).toBe(0);
    db.close();
  });

  it("a heartbeat keeps an unextended live lease out of the sweep's reach", () => {
    const db = freshDb();
    liveUnextendedLease(db, "live", RESERVATION_STALE_MS / 60_000 + 1);
    // The heartbeat the browser fires every 20 s. It needs no money — the call is
    // still inside what was reserved — and must nonetheless mark the lease alive.
    const covered = ensureTutorLeaseCovers(db, "live", REALTIME_FLAGSHIP, 1, 100);
    expect(covered).toBe(true);
    expect(sweepStaleReservations(db)).toBe(0);
    expect(tutorReservedUsd(db, "live")).toBeGreaterThan(0);
    db.close();
  });

  it("holds at ANY ttl, which is the property the old comment only claimed", () => {
    // The generalisation: liveness is now an observed fact, so no relationship between
    // RESERVATION_STALE_MS and TUTOR_SESSION_MINUTES has to hold for the guard to work.
    for (const ttlMinutes of [1, 5, 15, 30, 60]) {
      const db = freshDb();
      liveUnextendedLease(db, "live", 90);
      ensureTutorLeaseCovers(db, "live", REALTIME_FLAGSHIP, 1, 100);
      expect(sweepStaleReservations(db, ttlMinutes * 60_000), `ttl=${ttlMinutes}m`).toBe(0);
      db.close();
    }
  });

  it("the keep-alive costs nothing and never moves the lease's OPEN instant", () => {
    // The three properties that make a $0 row safe. Moving MIN(reserved_at) forward is
    // precisely how the original defect disabled the [T2b] ceiling and [T2c] floor, so
    // a keep-alive that did it would re-create the bug it exists to prevent.
    const db = freshDb();
    const reserved = liveUnextendedLease(db, "live", 20);
    const openedBefore = tutorLeaseOpenedAtMs(db, "live");
    expect(touchTutorLease(db, "live", REALTIME_FLAGSHIP)).toBe(true);
    expect(tutorReservedUsd(db, "live")).toBeCloseTo(reserved, 9);
    expect(tutorLeaseOpenedAtMs(db, "live")).toBe(openedBefore);
    expect((Date.now() - (openedBefore as number)) / 60_000).toBeGreaterThan(19);
    db.close();
  });

  it("does not spam rows: a fresh lease needs no keep-alive yet", () => {
    const db = freshDb();
    liveUnextendedLease(db, "live", 1); // reserved a minute ago
    expect(touchTutorLease(db, "live", REALTIME_FLAGSHIP)).toBe(false);
    const rows = db
      .prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE content_hash = ?")
      .get(tutorContentHash("live")) as { n: number };
    expect(rows.n).toBe(1);
    db.close();
  });

  it("keeps nothing alive when there is no open lease", () => {
    // A finalized or never-opened session must not acquire a phantom pending row —
    // that would make a closed lease look live and block its own sweep forever.
    const db = freshDb();
    expect(touchTutorLease(db, "gone", REALTIME_FLAGSHIP)).toBe(false);
    expect(tutorReservedUsd(db, "gone")).toBe(0);
    db.close();
  });

  it("still lets a genuinely abandoned lease go stale and commit", () => {
    // The opposite failure: if the keep-alive made leases immortal, an abandoned call's
    // spend would never reach the ledger. Silence must still resolve.
    const db = freshDb();
    const reserved = liveUnextendedLease(db, "dead", 90);
    // no heartbeat at all — the browser is gone
    expect(sweepStaleReservations(db)).toBe(1);
    expect(monthToDateSpend(db)).toBeCloseTo(reserved, 9);
    db.close();
  });
});

describe("an abandoned tutor lease still records its spend, exactly once", () => {
  it("commits the WHOLE lease in one row when every part of it is stale", () => {
    const db = freshDb();
    const hash = tutorContentHash("dead");
    reserveAt(db, hash, 0.5, 60);
    reserveAt(db, hash, 0.05, 50);
    reserveAt(db, hash, 0.05, 40);
    expect(sweepStaleReservations(db)).toBe(3);
    const rows = committed(db, hash);
    expect(rows.n).toBe(1);
    expect(rows.total).toBeCloseTo(0.6, 9);
    expect(tutorReservedUsd(db, "dead")).toBe(0);
    db.close();
  });

  it("a late /end after a swept lease commits NOTHING more", () => {
    // The opposite failure to the one being fixed: having made the sweep whole, a
    // finalize arriving afterwards must not add a second charge.
    const db = freshDb();
    const hash = tutorContentHash("dead");
    reserveAt(db, hash, 0.5, 60);
    reserveAt(db, hash, 0.05, 50);
    sweepStaleReservations(db);
    const extra = finalizeTutorLease(db, "dead", REALTIME_FLAGSHIP, 21);
    expect(extra).toBe(0);
    expect(committed(db, hash).n).toBe(1);
    expect(monthToDateSpend(db)).toBeCloseTo(0.55, 9);
    db.close();
  });

  it("never loses a charge: an abandoned lease is committed, not released", () => {
    const db = freshDb();
    reserveAt(db, tutorContentHash("dead"), 0.42, 60);
    sweepStaleReservations(db);
    expect(monthToDateSpend(db)).toBeCloseTo(0.42, 9);
    db.close();
  });

  it("an ordinary stale reservation still RELEASES — a crashed cascade call was never charged", () => {
    const db = freshDb();
    reserveAt(db, "seg:abc123", 0.02, 60);
    expect(sweepStaleReservations(db)).toBe(1);
    expect(monthToDateSpend(db)).toBe(0);
    db.close();
  });
});

describe("one rule, one dialect (RETRO-004 §3)", () => {
  it("generates the sweep's SQL from the exported predicate's own prefix list", () => {
    // `isAssumedRunLeaseHash` was exported, documented as the authority, and DEAD:
    // dropping its `pa:` clause passed 1012/1012 because the sweep never consulted it.
    // Now the SQL is derived from the same list, so they cannot disagree.
    for (const prefix of ASSUMED_RUN_PREFIXES) {
      expect(isAssumedRunLeaseHash(`${prefix}anything`)).toBe(true);
      expect(ASSUMED_RUN_SQL).toContain(`'${prefix}%'`);
    }
    expect(isAssumedRunLeaseHash("seg:abc")).toBe(false);
    expect(ASSUMED_RUN_SQL).not.toContain("'seg:%'");
  });

  it("every assumed-run prefix really commits on sweep, not just the tutor one", () => {
    // The behavioural half: the predicate agreeing with the SQL is worth nothing if
    // neither is exercised. Each prefix gets a real stale lease and must be committed.
    for (const prefix of ASSUMED_RUN_PREFIXES) {
      const db = freshDb();
      reserveAt(db, `${prefix}x`, 0.11, 60);
      sweepStaleReservations(db);
      expect(monthToDateSpend(db)).toBeCloseTo(0.11, 9);
      db.close();
    }
  });
});
