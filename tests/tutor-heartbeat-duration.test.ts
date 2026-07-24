import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { REALTIME_FLAGSHIP } from "@/lib/analysis/rates";

// [T2b] The server-side DURATION ceiling, enforced for real (the follow-up to the
// review of PR #58). `maxSessionSeconds` used to be shipped to OpenAI as if the API
// bounded the call for us — it has no such field, so the ceiling enforced NOTHING and
// the unknown param 400'd the mint (OBS-001). The ceiling now lives where the server
// already tracks the call: the heartbeat route. These tests drive the REAL heartbeat
// and end routes against a real disposable DB and prove:
//
//   * a heartbeat past `maxTutorSessionSeconds()` refuses with the SAME shape the
//     client already winds down on (`covered: false`, 402) — no client change;
//   * the ceiling is measured from the SERVER's clock (the lease's open `reserved_at`),
//     so a client under-reporting its elapsed time cannot run past it;
//   * the refusal does NOT release the lease: the spend actually incurred is still
//     committed — by `/end` when the client winds down, and by the [T2a] stale sweep
//     when it abandons instead. A duration refusal never loses recorded spend.

const MAX_MINUTES = 1; // a 1-minute ceiling keeps the test fast

let root: string;
let heartbeatPOST: typeof import("@/app/api/tutor/session/[id]/heartbeat/route").POST;
let endPOST: typeof import("@/app/api/tutor/session/[id]/end/route").POST;
let getDb: typeof import("@/lib/db").getDb;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let money: typeof import("@/lib/tutor/money");
let budget: typeof import("@/lib/analysis/budget");

const FLAG = REALTIME_FLAGSHIP;

beforeAll(async () => {
  root = tmpDir("erika-tutor-heartbeat-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  process.env.TUTOR_MAX_SESSION_MINUTES = String(MAX_MINUTES);

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
  delete process.env.TUTOR_MAX_SESSION_MINUTES;
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

/** Drive the real end route — what the client's wind-down calls on `covered: false`. */
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
    .prepare("SELECT COUNT(*) AS n FROM spend_ledger WHERE content_hash = ? AND state = 'pending'")
    .get(hash) as { n: number };
  const committed = getDb()
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM spend_ledger WHERE content_hash = ? AND state = 'committed'",
    )
    .get(hash) as { n: number; total: number };
  return { pending: pending.n, committed };
}

describe("[T2b] the heartbeat enforces the server-side duration ceiling", () => {
  it("covers a call that is still inside the ceiling", async () => {
    money.openTutorLease(getDb(), "d1", FLAG, 10, 100);
    const { status, body } = await beat("d1", 20);
    expect(status).toBe(200);
    expect(body.covered).toBe(true);
    expect(rows("d1").pending).toBeGreaterThan(0); // the lease stays open
  });

  it("refuses past the ceiling with the SAME shape the client winds down on", async () => {
    money.openTutorLease(getDb(), "d2", FLAG, 10, 100);
    ageLease("d2", 2 * MAX_MINUTES); // the server has seen twice the ceiling

    const { status, body } = await beat("d2", 2 * MAX_MINUTES * 60);
    // The client's wind-down (`app/practice/tutor/page.tsx`) keys on exactly this.
    expect(body.covered).toBe(false);
    expect(status).toBe(402);
    // …and the reason is legible, so a duration refusal is not mistaken for a budget one.
    expect((body.error as { code: string }).code).toBe("duration_limit");
    expect(body.maxSessionSeconds).toBe(money.maxTutorSessionSeconds());

    // The refusal did NOT release the lease — the incurred spend is still reserved.
    expect(rows("d2").pending).toBeGreaterThan(0);
    expect(rows("d2").committed.n).toBe(0);

    // Winding the call down commits the spend actually incurred: ONE row, ~2 minutes.
    const { committedUsd } = await end("d2", 2 * MAX_MINUTES * 60);
    expect(committedUsd).toBeGreaterThan(money.estimateTutorSessionUsd(FLAG, 1.9 * MAX_MINUTES));
    expect(committedUsd).toBeLessThan(money.estimateTutorSessionUsd(FLAG, 2.5 * MAX_MINUTES));
    const after = rows("d2");
    expect(after.pending).toBe(0);
    expect(after.committed.n).toBe(1);
    expect(after.committed.total).toBeCloseTo(committedUsd);
    expect(budget.monthToDateSpend(getDb())).toBeCloseTo(committedUsd);
  });

  it("measures the ceiling from the SERVER's clock, not the client's report", async () => {
    money.openTutorLease(getDb(), "d3", FLAG, 10, 100);
    ageLease("d3", 2 * MAX_MINUTES);

    // The client claims one second — the server saw a call twice the ceiling long.
    const { status, body } = await beat("d3", 1);
    expect(status).toBe(402);
    expect(body.covered).toBe(false);
    expect((body.error as { code: string }).code).toBe("duration_limit");

    // And the under-report cannot under-pay either ([T2c] floors the billed minutes).
    const { committedUsd } = await end("d3", 1);
    expect(committedUsd).toBeGreaterThan(money.estimateTutorSessionUsd(FLAG, 1.9 * MAX_MINUTES));
  });

  it("still COMMITS an abandoned call refused on duration (the [T2a] rule is intact)", async () => {
    money.openTutorLease(getDb(), "d4", FLAG, 10, 100);
    ageLease("d4", 2 * MAX_MINUTES);
    expect((await beat("d4", 2 * MAX_MINUTES * 60)).body.covered).toBe(false);

    // The client never calls /end. Age the lease past the reservation TTL and sweep.
    ageLease("d4", 30);
    expect(budget.sweepStaleReservations(getDb())).toBeGreaterThanOrEqual(1);
    const after = rows("d4");
    expect(after.pending).toBe(0);
    expect(after.committed.n).toBe(1); // committed, NOT released to $0
    expect(after.committed.total).toBeGreaterThan(0);
  });
});
