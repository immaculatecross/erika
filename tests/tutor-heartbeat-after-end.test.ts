import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { REALTIME_FLAGSHIP } from "@/lib/analysis/rates";

// The DOUBLE-CHARGE RACE (money defect A) — a heartbeat that arrives AFTER `/end`.
//
// The client heartbeats on a fire-and-forget interval, so one can be in flight while the
// wind-down runs (`app/practice/tutor/page.tsx`: the interval used to keep firing across
// the take-assembly and upload awaits that precede `/end`). Landing after `/end` had
// finalized the lease, the heartbeat found $0 reserved and `ensureTutorLeaseCovers`
// reserved the WHOLE elapsed cost again as an orphan pending row — one no `/end` would
// ever finalize, so the [T2a] tutor sweep COMMITTED it. The session was billed twice:
// the reviewer measured MTD 0.72003 against a legitimate 0.28803, ~2.5×.
//
// These tests drive the REAL heartbeat and end route handlers against a real disposable
// SQLite DB and prove:
//
//   1. a heartbeat arriving after `/end` reserves NOTHING and commits NOTHING — the
//      ledger carries EXACTLY ONE committed row, for the true elapsed time;
//   2. no orphan pending row survives for the sweep to find, so running
//      `sweepStaleReservations` after the race adds NO charge;
//   3. the normal in-session heartbeat path is unaffected (it still extends a live lease);
//   4. the [T2a] abandonment rule still holds — a genuinely abandoned OPEN lease is still
//      COMMITTED by the sweep, not released to $0.
//
// The refusal reuses the `covered: false` / 402 shape the client already winds down on
// (a distinct `error.code` of `session_closed` tells it apart from `budget` /
// `duration_limit`), so the server fix needs no client change to be effective.

let root: string;
let heartbeatPOST: typeof import("@/app/api/tutor/session/[id]/heartbeat/route").POST;
let endPOST: typeof import("@/app/api/tutor/session/[id]/end/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let money: typeof import("@/lib/tutor/money");
let budget: typeof import("@/lib/analysis/budget");

const FLAG = REALTIME_FLAGSHIP;
/** The true length of the call in the race scenario, in minutes. */
const CALL_MINUTES = 4;

beforeAll(async () => {
  root = tmpDir("erika-tutor-hb-after-end-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;

  heartbeatPOST = (await import("@/app/api/tutor/session/[id]/heartbeat/route")).POST;
  endPOST = (await import("@/app/api/tutor/session/[id]/end/route")).POST;
  getDb = (await import("@/lib/db")).getDb;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  money = await import("@/lib/tutor/money");
  budget = await import("@/lib/analysis/budget");
  writeSettings(getDb(), { monthlyBudgetUsd: 100 });
});

afterEach(() => {
  getDb().prepare("DELETE FROM spend_ledger").run();
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** Drive the real heartbeat route for `id` with a client-reported elapsed time. */
async function beat(id: string, elapsedSeconds: number) {
  const req = new Request(`http://localhost/api/tutor/session/${id}/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ elapsedSeconds }),
  });
  const res = await heartbeatPOST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Drive the real end route — the client's wind-down. */
async function end(id: string, elapsedSeconds: number) {
  const req = new Request(`http://localhost/api/tutor/session/${id}/end`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ elapsedSeconds }),
  });
  const res = await endPOST(req, { params: Promise.resolve({ id }) });
  return (await res.json()) as { committedUsd: number };
}

/** Backdate the lease's open time so the SERVER sees a call that has run `minutes`. */
function ageLease(id: string, minutes: number): void {
  getDb()
    .prepare("UPDATE spend_ledger SET reserved_at = datetime('now', ?) WHERE content_hash = ?")
    .run(`-${minutes} minutes`, money.tutorContentHash(id));
}

function rows(id: string) {
  const hash = money.tutorContentHash(id);
  const pending = getDb()
    .prepare("SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
    .get(hash) as { n: number; total: number };
  const committed = getDb()
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'committed'",
    )
    .get(hash) as { n: number; total: number };
  return { pending, committed };
}

describe("a heartbeat arriving after /end cannot re-open the lease (double-charge race)", () => {
  it("refuses with the client's wind-down shape and reserves NOTHING", async () => {
    // A four-minute call, opened and then wound down normally.
    money.openTutorLease(getDb(), "r1", FLAG, 10, 100);
    ageLease("r1", CALL_MINUTES);
    const { committedUsd } = await end("r1", CALL_MINUTES * 60);
    const legitimate = committedUsd;
    // The legitimate charge is the four minutes actually spoken (the server-tracked
    // floor adds only the sub-second test runtime).
    expect(legitimate).toBeGreaterThanOrEqual(money.estimateTutorSessionUsd(FLAG, CALL_MINUTES));
    expect(legitimate).toBeLessThan(money.estimateTutorSessionUsd(FLAG, CALL_MINUTES + 0.1));

    // …and now the in-flight heartbeat lands, a beat too late.
    const { status, body } = await beat("r1", CALL_MINUTES * 60);
    expect(status).toBe(402);
    expect(body.covered).toBe(false); // the shape the existing client already handles
    expect((body.error as { code: string }).code).toBe("session_closed");

    // It created nothing: no orphan pending row, and no second committed row.
    const after = rows("r1");
    expect(after.pending.n).toBe(0);
    expect(after.pending.total).toBe(0);
    expect(after.committed.n).toBe(1); // EXACTLY ONE committed row for the whole session
    expect(after.committed.total).toBeCloseTo(legitimate);

    // The user is billed for the time they used — once. (The defect billed ~2.5×.)
    expect(budget.monthToDateSpend(getDb())).toBeCloseTo(legitimate);
  });

  it("leaves the sweep nothing to commit — no charge is added after the race", async () => {
    money.openTutorLease(getDb(), "r2", FLAG, 10, 100);
    ageLease("r2", CALL_MINUTES);
    const { committedUsd: legitimate } = await end("r2", CALL_MINUTES * 60);

    // The race: a late heartbeat, then the startup sweep that used to commit its orphan.
    await beat("r2", CALL_MINUTES * 60);
    const beforeSweep = budget.monthToDateSpend(getDb());
    expect(beforeSweep).toBeCloseTo(legitimate);

    // Nothing pending exists to age, so even a zero-TTL sweep (the most aggressive
    // possible) finds nothing for this session and adds nothing.
    expect(budget.sweepStaleReservations(getDb(), 0)).toBe(0);
    expect(budget.monthToDateSpend(getDb())).toBeCloseTo(legitimate);
    expect(rows("r2").committed.n).toBe(1);
  });

  it("refuses a heartbeat for a session that never opened a lease", async () => {
    const { status, body } = await beat("never-opened", 30);
    expect(status).toBe(402);
    expect((body.error as { code: string }).code).toBe("session_closed");
    // The whole ledger is still empty — the refusal is not a reservation.
    expect((getDb().prepare("SELECT COUNT(*) AS n FROM spend_ledger").get() as { n: number }).n).toBe(0);
  });

  it("still extends a LIVE lease — the normal in-session heartbeat is unaffected", async () => {
    money.openTutorLease(getDb(), "r3", FLAG, 10, 100);
    const reservedAtOpen = money.tutorReservedUsd(getDb(), "r3");

    // Inside the lease: covered, and no over-reservation (the heartbeat is idempotent).
    const inside = await beat("r3", 60);
    expect(inside.status).toBe(200);
    expect(inside.body.covered).toBe(true);
    expect(money.tutorReservedUsd(getDb(), "r3")).toBeCloseTo(reservedAtOpen);

    // Past the lease: covered again, having reserved the shortfall for a longer call.
    const outside = await beat("r3", 15 * 60);
    expect(outside.status).toBe(200);
    expect(outside.body.covered).toBe(true);
    expect(money.tutorReservedUsd(getDb(), "r3")).toBeGreaterThan(reservedAtOpen);
    expect(rows("r3").pending.n).toBeGreaterThan(1); // the lease grew; it did not restart

    // And `/end` still finalizes it to ONE committed row at the elapsed cost.
    const { committedUsd } = await end("r3", 5 * 60);
    expect(committedUsd).toBeCloseTo(money.estimateTutorSessionUsd(FLAG, 5), 3);
    expect(rows("r3").pending.n).toBe(0);
    expect(rows("r3").committed.n).toBe(1);
  });

  it("[T2a] a genuinely abandoned OPEN lease is still COMMITTED, not released", async () => {
    money.openTutorLease(getDb(), "r4", FLAG, 10, 100);
    // A live call that heartbeats and then vanishes — the client never calls `/end`.
    expect((await beat("r4", 60)).body.covered).toBe(true);
    const reserved = money.tutorReservedUsd(getDb(), "r4");
    expect(reserved).toBeGreaterThan(0);

    ageLease("r4", 30); // past RESERVATION_STALE_MS
    expect(budget.sweepStaleReservations(getDb())).toBeGreaterThanOrEqual(1);

    const after = rows("r4");
    expect(after.pending.n).toBe(0);
    expect(after.committed.n).toBe(1); // committed — an assumed-live session must not vanish
    expect(after.committed.total).toBeCloseTo(reserved);
    expect(budget.monthToDateSpend(getDb())).toBeCloseTo(reserved);
  });
});
