import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { computeStreak, REPAIRS_PER_MONTH } from "@/lib/streak/compute";
import { buildStreak, listStreakRepairs, recordStreakRepairs, repairsUsedInMonth } from "@/lib/streak/store";
import { streakCaption } from "@/lib/streak/caption";
import { recordDayComplete } from "@/lib/day-ledger";

// E-38 criterion 1 (D-24). The streak's brain is PURE — day keys in, a run out — so
// every rule of the repair mechanic is checked against hand-written days: a clean
// run, one gap repaired, a second gap in the same month repaired, a THIRD gap that
// correctly ends the run, a month rollover restoring credits, both DST boundaries,
// and idempotent recomputation (recomputing must never double-spend a credit).
//
// The mechanic under test, verbatim from D-24: two AUTOMATIC, SILENT repairs per
// calendar month, earned not bought. Nothing in these tests (or the code) prompts,
// warns, counts down or charges — when the credits are gone the run simply ends.
//
// `currentRun` is the run's inclusive SPAN (operator ruling, 2026-07-24): completed
// days PLUS the repaired days bridging them, with the repairs disclosed alongside.
// Every expectation below is derived that way, and the honesty invariant is asserted
// separately: a repaired day is never recorded as COMPLETED (`day_ledger` untouched,
// `lastCompletedDay` is a real completed day, `repairedDays` stays its own list).

/** Consecutive local days, oldest first, starting at `from`. */
function days(from: string, n: number): string[] {
  const [y, m, d] = from.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(y, m - 1, d + i, 12, 0, 0, 0);
    out.push(
      `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`,
    );
  }
  return out;
}

describe("computeStreak — the consecutive-day run", () => {
  it("counts a clean run of completed local days up to and including today", () => {
    const r = computeStreak({ completedDays: days("2026-07-11", 14), today: "2026-07-24" });
    expect(r.currentRun).toBe(14);
    expect(r.repairedDays).toEqual([]);
    expect(r.newRepairs).toEqual([]);
    expect(r.repairsUsedThisMonth).toBe(0);
    expect(r.lastCompletedDay).toBe("2026-07-24");
  });

  it("does NOT break the run when today is merely not finished yet", () => {
    // 10 days through yesterday; today has no ledger row because the day isn't over.
    const r = computeStreak({ completedDays: days("2026-07-14", 10), today: "2026-07-24" });
    expect(r.currentRun).toBe(10);
    expect(r.lastCompletedDay).toBe("2026-07-23");
    expect(r.newRepairs).toEqual([]); // and nothing was spent to "protect" it
  });

  it("is zero — and silent — when the last two days were both missed", () => {
    const r = computeStreak({ completedDays: days("2026-07-01", 5), today: "2026-07-24" });
    expect(r.currentRun).toBe(0);
    expect(r.repairedDays).toEqual([]);
    expect(r.newRepairs).toEqual([]);
    expect(r.lastCompletedDay).toBeNull();
  });

  it("has no run at all on a first-ever day with nothing completed", () => {
    const r = computeStreak({ completedDays: [], today: "2026-07-24" });
    expect(r.currentRun).toBe(0);
    expect(r.repairsUsedThisMonth).toBe(0);
  });
});

describe("computeStreak — earned, silent repairs (two per calendar month)", () => {
  it("bridges ONE missed day automatically, keeping the run's SPAN intact", () => {
    // 11th–24th July except the 18th: a 14-day span, 13 of them completed.
    const completed = days("2026-07-11", 14).filter((d) => d !== "2026-07-18");
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.currentRun).toBe(14); // the span — the repair keeps the run whole
    expect(r.repairedDays).toEqual([{ localDay: "2026-07-18", chargedMonth: "2026-07" }]);
    expect(r.newRepairs).toHaveLength(1);
    expect(r.repairsUsedThisMonth).toBe(1);
    // …and the bridged day is NOT claimed as practice: it is disclosed as a repair,
    // and the run's last completed day is a day the learner really did.
    expect(completed).not.toContain("2026-07-18");
    expect(r.lastCompletedDay).toBe("2026-07-24");
    expect(r.currentRun).toBe(completed.length + r.repairedDays.length);
  });

  it("pins the operator's example end to end: Day 14 · repaired Tue", () => {
    // 2026-07-21 is a Tuesday; 2026-07-24 (today) is a Friday.
    const completed = days("2026-07-11", 14).filter((d) => d !== "2026-07-21");
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.currentRun).toBe(14);
    expect(r.repairedDays).toEqual([{ localDay: "2026-07-21", chargedMonth: "2026-07" }]);
    expect(streakCaption(r, "2026-07-24")).toBe("Day 14 · repaired Tue");
  });

  it("bridges a SECOND gap in the same month — both credits spent, run intact", () => {
    // 5th–24th July (a 20-day span) with the 10th and 18th missed: 18 completed + 2 bridged.
    const completed = days("2026-07-05", 20).filter((d) => d !== "2026-07-10" && d !== "2026-07-18");
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.currentRun).toBe(20);
    expect(completed).toHaveLength(18); // only 18 days were actually completed
    expect(r.repairedDays.map((x) => x.localDay)).toEqual(["2026-07-18", "2026-07-10"]);
    expect(r.repairsUsedThisMonth).toBe(REPAIRS_PER_MONTH);
  });

  it("lets the run END on a THIRD gap in the same month — no guilt, no purchase", () => {
    const completed = days("2026-07-02", 23).filter(
      (d) => d !== "2026-07-06" && d !== "2026-07-12" && d !== "2026-07-18",
    );
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    // Walking back: 24→19 complete (6), 18 repaired, 17→13 (5), 12 repaired, 11→07 (5),
    // then 06 has no credit left ⇒ the run stops there. 16 completed + 2 bridged = an
    // 18-day span (07–24 July inclusive).
    expect(r.currentRun).toBe(18);
    expect(r.lastCompletedDay).toBe("2026-07-24");
    expect(r.repairedDays.map((x) => x.localDay)).toEqual(["2026-07-18", "2026-07-12"]);
    expect(r.repairsUsedThisMonth).toBe(REPAIRS_PER_MONTH);
    // The third gap is simply where the run ends: no extra credit was charged.
    expect(r.newRepairs).toHaveLength(2);
  });

  it("never bridges TWO CONSECUTIVE missed days, however many credits are left", () => {
    const completed = days("2026-07-11", 14).filter((d) => d !== "2026-07-17" && d !== "2026-07-18");
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.currentRun).toBe(6); // 19th–24th only
    expect(r.repairedDays).toEqual([]);
    expect(r.repairsUsedThisMonth).toBe(0); // credits were NOT burned on an unbridgeable gap
  });

  it("restores a full pair of credits on a MONTH ROLLOVER (a run crossing months)", () => {
    // 20 June – 24 July, missing 24+27 June and 6+14 July: four gaps, two per month.
    const completed = [...days("2026-06-20", 11), ...days("2026-07-01", 24)].filter(
      (d) => !["2026-06-24", "2026-06-27", "2026-07-06", "2026-07-14"].includes(d),
    );
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.currentRun).toBe(35); // the span: 31 completed + the 4 bridged days
    expect(completed).toHaveLength(31);
    expect(r.repairedDays.map((x) => x.localDay)).toEqual([
      "2026-07-14",
      "2026-07-06",
      "2026-06-27",
      "2026-06-24",
    ]);
    // Charged to the month of the MISSED day, so July's pair is independent of June's.
    expect(r.repairedDays.filter((x) => x.chargedMonth === "2026-06")).toHaveLength(2);
    expect(r.repairedDays.filter((x) => x.chargedMonth === "2026-07")).toHaveLength(2);
    expect(r.repairsUsedThisMonth).toBe(2); // July only — June's are a different month
  });

  it("charges a gap on the last day of a month to THAT month, not the current one", () => {
    // 25–29 June, then all of 1–24 July: 30 June is the single missed day.
    const completed = [...days("2026-06-25", 5), ...days("2026-07-01", 24)];
    const r = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(r.repairedDays).toEqual([{ localDay: "2026-06-30", chargedMonth: "2026-06" }]);
    expect(r.repairsUsedThisMonth).toBe(0); // July's two credits are untouched
    expect(r.currentRun).toBe(30); // the span 25 Jun–24 Jul: 29 completed + 1 bridged
  });
});

describe("computeStreak — DST boundaries (the day key is local, never UTC)", () => {
  const tzBefore = process.env.TZ;
  afterEach(() => {
    if (tzBefore === undefined) delete process.env.TZ;
    else process.env.TZ = tzBefore;
  });

  it("counts a run across SPRING FORWARD as consecutive calendar days (Europe/Rome)", () => {
    process.env.TZ = "Europe/Rome"; // 2026-03-29: 02:00 → 03:00, a 23-hour day
    const r = computeStreak({ completedDays: days("2026-03-25", 8), today: "2026-04-01" });
    expect(r.currentRun).toBe(8); // the short day is still exactly one day
  });

  it("counts a run across FALL BACK as consecutive calendar days (Europe/Rome)", () => {
    process.env.TZ = "Europe/Rome"; // 2026-10-25: 03:00 → 02:00, a 25-hour day
    const r = computeStreak({ completedDays: days("2026-10-22", 7), today: "2026-10-28" });
    expect(r.currentRun).toBe(7);
  });

  it("bridges a gap that IS the DST-shifted day, and charges it to its own month", () => {
    process.env.TZ = "Europe/Rome";
    const completed = days("2026-03-25", 8).filter((d) => d !== "2026-03-29");
    const r = computeStreak({ completedDays: completed, today: "2026-04-01" });
    expect(r.currentRun).toBe(8); // the 8-day span: 7 completed + the bridged DST day
    expect(r.repairedDays).toEqual([{ localDay: "2026-03-29", chargedMonth: "2026-03" }]);
  });

  it("holds in a half-hour, southern-hemisphere zone too (Australia/Lord_Howe)", () => {
    process.env.TZ = "Australia/Lord_Howe"; // +10:30/+11:00, a 30-minute DST shift
    const r = computeStreak({ completedDays: days("2026-04-02", 6), today: "2026-04-07" });
    expect(r.currentRun).toBe(6);
  });
});

describe("computeStreak — idempotent recomputation never double-spends", () => {
  it("charges nothing new when the same repair is already in the ledger", () => {
    const completed = days("2026-07-11", 14).filter((d) => d !== "2026-07-18");
    const first = computeStreak({ completedDays: completed, today: "2026-07-24" });
    expect(first.newRepairs).toHaveLength(1);

    const again = computeStreak({ completedDays: completed, repairs: first.repairedDays, today: "2026-07-24" });
    expect(again.currentRun).toBe(first.currentRun);
    expect(again.repairedDays).toEqual(first.repairedDays);
    expect(again.newRepairs).toEqual([]); // nothing re-charged
    expect(again.repairsUsedThisMonth).toBe(1); // still ONE credit, not two
  });

  it("keeps a spent credit spent even after its day leaves the current run", () => {
    // A repair was charged for 2 July. The run has since broken (nothing since the 5th),
    // and a NEW run starts on the 22nd with a gap on the 23rd. Only one credit is left.
    const ledger = [{ localDay: "2026-07-02", chargedMonth: "2026-07" }];
    const completed = [...days("2026-07-01", 5), "2026-07-22", "2026-07-24"];
    const r = computeStreak({ completedDays: completed, repairs: ledger, today: "2026-07-24" });
    expect(r.repairedDays).toEqual([{ localDay: "2026-07-23", chargedMonth: "2026-07" }]);
    expect(r.repairsUsedThisMonth).toBe(2); // the old charge still counts — history stands
    expect(r.currentRun).toBe(3); // the span 22–24 July: 2 completed + 1 bridged
    expect(r.lastCompletedDay).toBe("2026-07-24");
  });

  it("refuses a third repair when the ledger already shows the month's two spent", () => {
    const ledger = [
      { localDay: "2026-07-02", chargedMonth: "2026-07" },
      { localDay: "2026-07-04", chargedMonth: "2026-07" },
    ];
    const completed = days("2026-07-18", 7).filter((d) => d !== "2026-07-21");
    const r = computeStreak({ completedDays: completed, repairs: ledger, today: "2026-07-24" });
    expect(r.newRepairs).toEqual([]);
    expect(r.currentRun).toBe(3); // 22nd–24th; the 21st is unbridgeable, so the run ends
  });
});

describe("the repair ledger (v25) — the store", () => {
  const dirs: string[] = [];
  function freshDb(): Db {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-streak-"));
    dirs.push(dir);
    return openDatabase(path.join(dir, "erika.db"));
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  it("records a repair once — a re-record is a no-op (INSERT OR IGNORE on the PK)", () => {
    const db = freshDb();
    const repair = [{ localDay: "2026-07-18", chargedMonth: "2026-07" }];
    expect(recordStreakRepairs(db, repair)).toBe(1);
    expect(recordStreakRepairs(db, repair)).toBe(0);
    expect(listStreakRepairs(db)).toEqual(repair);
    db.close();
  });

  it("buildStreak reads day_ledger, bridges the gap, and persists exactly one credit", () => {
    const db = freshDb();
    for (const d of days("2026-07-11", 14)) {
      if (d === "2026-07-18") continue;
      recordDayComplete(db, d, { cardsDone: 9 });
    }

    const first = buildStreak(db, "2026-07-24");
    expect(first.currentRun).toBe(14); // the span; 13 days were actually completed
    expect(first.repairedDays.map((r) => r.localDay)).toEqual(["2026-07-18"]);
    expect(listStreakRepairs(db)).toHaveLength(1);

    // Recompute (every page load does): identical answer, still ONE ledger row.
    const second = buildStreak(db, "2026-07-24");
    expect(second).toEqual(first);
    expect(listStreakRepairs(db)).toHaveLength(1);
    // And again the next day, with the day completed — still one row.
    recordDayComplete(db, "2026-07-25", { cardsDone: 4 });
    const third = buildStreak(db, "2026-07-25");
    expect(third.currentRun).toBe(15);
    expect(listStreakRepairs(db)).toHaveLength(1);
    db.close();
  });

  it("counts the span but records only COMPLETED days — the ledgers disagree honestly", () => {
    const db = freshDb();
    for (const d of days("2026-07-11", 14)) {
      if (d === "2026-07-18") continue;
      recordDayComplete(db, d, { cardsDone: 9 });
    }
    const view = buildStreak(db, "2026-07-24");
    const completedRows = (db.prepare("SELECT COUNT(*) AS n FROM day_ledger").get() as { n: number }).n;
    expect(view.currentRun).toBe(14); // the span the learner lived
    expect(completedRows).toBe(13); // the days they actually completed
    expect(view.currentRun).toBe(completedRows + view.repairedDays.length);
    // The bridged day is in the repair ledger and NOWHERE in the completion ledger.
    expect(listStreakRepairs(db).map((r) => r.localDay)).toEqual(["2026-07-18"]);
    expect(db.prepare("SELECT 1 FROM day_ledger WHERE local_day = '2026-07-18'").get()).toBeUndefined();
    db.close();
  });

  it("keeps the credit BALANCE server-side — it never reaches the view (D-24)", () => {
    // [review F5] `repairsUsedThisMonth` is a credit balance; shipping it in the
    // /api/learn/today JSON would leave it one interpolation away from the countdown
    // D-24 bans. It lives on the pure result and this server-only accessor instead.
    const db = freshDb();
    for (const d of days("2026-07-11", 14)) {
      if (d === "2026-07-18") continue;
      recordDayComplete(db, d, { cardsDone: 9 });
    }
    const view = buildStreak(db, "2026-07-24");
    expect(Object.keys(view).sort()).toEqual(["currentRun", "lastCompletedDay", "repairedDays"]);
    expect(JSON.stringify(view)).not.toContain("repairsUsed");
    // …while the server can still audit it.
    expect(repairsUsedInMonth(db, "2026-07-24")).toBe(1);
    expect(repairsUsedInMonth(db, "2026-08-01")).toBe(0); // a new month, a clean balance
    db.close();
  });

  it("writes nothing to day_ledger — a repaired day is NOT a completed day", () => {
    const db = freshDb();
    for (const d of days("2026-07-20", 5)) {
      if (d === "2026-07-22") continue;
      recordDayComplete(db, d, { cardsDone: 3 });
    }
    buildStreak(db, "2026-07-24");
    const ledgerDays = (db.prepare("SELECT local_day FROM day_ledger ORDER BY local_day").all() as {
      local_day: string;
    }[]).map((r) => r.local_day);
    expect(ledgerDays).toEqual(["2026-07-20", "2026-07-21", "2026-07-23", "2026-07-24"]);
    db.close();
  });
});
