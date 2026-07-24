import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tmpDir, makeWav } from "./helpers";
import type { Db } from "@/lib/db";
import type { PronunciationDrill } from "@/lib/pronunciation";

// E-37 THE MONEY PATH (never-waivable). Azure Pronunciation Assessment is a NEW BILLED
// external call, so every one of these is a contract, not a nicety:
//
//   * a drill RESERVES BEFORE IT CALLS — the pending row exists at the instant the
//     provider is invoked, not after;
//   * a cap-exceeded attempt is refused truthfully and mints NO CHARGE AND NO SCORE —
//     no ledger row, no attempt row, and the provider is never called;
//   * a crash mid-call still records the incurred spend (the abandoned `pa:` lease
//     COMMITS on sweep instead of releasing to $0);
//   * an answered-but-unreadable reply BILLS (the provider ran) and stores no score;
//   * a transport failure with no response bills NOTHING;
//   * no path double-charges: one assessment, exactly one committed row.
//
// Every call goes through the fixture scorer — D-13: no test makes a network call, and
// the sandbox has no key and no egress anyway.

let root: string;
let openDatabase: typeof import("@/lib/db").openDatabase;
let writeSettings: typeof import("@/lib/settings").writeSettings;
let createSession: typeof import("@/lib/sessions").createSession;
let persistSegmentFindings: typeof import("@/lib/analysis/findings").persistSegmentFindings;
let pronunciationDrill: typeof import("@/lib/pronunciation").pronunciationDrill;
let scoreAttempt: typeof import("@/lib/pronunciation").scoreAttempt;
let BudgetExceededError: typeof import("@/lib/pronunciation").BudgetExceededError;
let PronunciationParseError: typeof import("@/lib/pronunciation").PronunciationParseError;
let PronunciationScorerUnavailableError: typeof import("@/lib/pronunciation").PronunciationScorerUnavailableError;
let ScorerUnavailableError: typeof import("@/lib/pronunciation").ScorerUnavailableError;
let createFixtureScorer: typeof import("@/lib/pronunciation/fixture-scorer").createFixtureScorer;
let sweepStaleReservations: typeof import("@/lib/analysis/budget").sweepStaleReservations;
let openPronunciationLease: typeof import("@/lib/pronunciation/money").openPronunciationLease;
let pronunciationCallCost: typeof import("@/lib/analysis/rates").pronunciationCallCost;
let PA_MODEL: typeof import("@/lib/analysis/rates").PA_MODEL;

let dbSeq = 0;
function freshDb(): Db {
  return openDatabase(path.join(root, `db-${dbSeq++}.sqlite`));
}

/** A finding whose correction is the drill line, in the E-17 included scope. */
function seedDrill(db: Db, sessionId = "s1"): PronunciationDrill {
  createSession(db, {
    id: sessionId,
    originalFilename: `${sessionId}.wav`,
    format: "wav",
    sizeBytes: 1,
    durationSeconds: 60,
  });
  persistSegmentFindings(db, {
    sessionId,
    contentHash: `${sessionId}-hash`,
    flagged: true,
    deepDone: true,
    findings: [
      {
        quote: "li gnocchi",
        correction: "Gli gnocchi sono buonissimi",
        category: "pronunciation",
        explanation: "the palatal lateral",
        severity: "high",
        startMs: 0,
        endMs: 2000,
      },
    ],
  });
  const id = (db.prepare("SELECT id FROM findings WHERE session_id = ?").get(sessionId) as { id: string }).id;
  return pronunciationDrill(db, id)!;
}

let wavSeq = 0;
/** A real 2-second wav on disk — the take being assessed. */
function takeFile(): { path: string; seconds: number } {
  const p = path.join(root, `take-${wavSeq++}.wav`);
  makeWav(p, 2);
  return { path: p, seconds: 2 };
}

function ledgerRows(db: Db): { cost_usd: number; state: string; content_hash: string; model: string }[] {
  return db
    .prepare("SELECT cost_usd, state, content_hash, model FROM spend_ledger ORDER BY rowid")
    .all() as { cost_usd: number; state: string; content_hash: string; model: string }[];
}

function attemptCount(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM pronunciation_attempts").get() as { n: number }).n;
}

beforeAll(async () => {
  root = tmpDir("erika-pron-money-");
  process.env.ERIKA_DATA_DIR = root;
  openDatabase = (await import("@/lib/db")).openDatabase;
  writeSettings = (await import("@/lib/settings")).writeSettings;
  createSession = (await import("@/lib/sessions")).createSession;
  persistSegmentFindings = (await import("@/lib/analysis/findings")).persistSegmentFindings;
  const pron = await import("@/lib/pronunciation");
  pronunciationDrill = pron.pronunciationDrill;
  scoreAttempt = pron.scoreAttempt;
  BudgetExceededError = pron.BudgetExceededError;
  PronunciationParseError = pron.PronunciationParseError;
  PronunciationScorerUnavailableError = pron.PronunciationScorerUnavailableError;
  ScorerUnavailableError = pron.ScorerUnavailableError;
  createFixtureScorer = (await import("@/lib/pronunciation/fixture-scorer")).createFixtureScorer;
  sweepStaleReservations = (await import("@/lib/analysis/budget")).sweepStaleReservations;
  openPronunciationLease = (await import("@/lib/pronunciation/money")).openPronunciationLease;
  const rates = await import("@/lib/analysis/rates");
  pronunciationCallCost = rates.pronunciationCallCost;
  PA_MODEL = rates.PA_MODEL;
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("E-37 money path — reserve before call", () => {
  it("holds a PENDING reservation at the instant the provider is called, then commits exactly one row", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();

    // Observe the ledger from INSIDE the provider call: reserve-before-call means the
    // pending row must already exist when the request is in flight.
    let duringCall: { cost_usd: number; state: string }[] = [];
    const scorer = createFixtureScorer("clean", {
      onCall: () => {
        duringCall = ledgerRows(db).map((r) => ({ cost_usd: r.cost_usd, state: r.state }));
      },
    });

    const { attempt } = await scoreAttempt(db, scorer, {
      drill,
      audioPath: take.path,
      audioSeconds: take.seconds,
    });

    expect(duringCall).toHaveLength(1);
    expect(duringCall[0].state).toBe("pending");
    expect(duringCall[0].cost_usd).toBeCloseTo(pronunciationCallCost(PA_MODEL, take.seconds), 10);

    // After: exactly ONE committed row, at the ACTUAL duration's cost, on the PA model.
    const after = ledgerRows(db);
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe("committed");
    expect(after[0].model).toBe(PA_MODEL);
    expect(after[0].content_hash).toBe(`pa:${attempt.id}`);
    expect(after[0].cost_usd).toBeCloseTo(pronunciationCallCost(PA_MODEL, take.seconds), 10);
    expect(attempt.costUsd).toBeCloseTo(after[0].cost_usd, 10);
    expect(attemptCount(db)).toBe(1);
  });

  it("bills by ACTUAL audio seconds — a longer take costs proportionally more", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const short = path.join(root, "short.wav");
    const long = path.join(root, "long.wav");
    makeWav(short, 1);
    makeWav(long, 4);

    await scoreAttempt(db, createFixtureScorer("clean"), { drill, audioPath: short, audioSeconds: 1 });
    await scoreAttempt(db, createFixtureScorer("clean"), { drill, audioPath: long, audioSeconds: 4 });

    const rows = ledgerRows(db);
    expect(rows).toHaveLength(2);
    expect(rows[1].cost_usd).toBeCloseTo(rows[0].cost_usd * 4, 10);
  });
});

describe("E-37 money path — the cap refuses truthfully", () => {
  it("mints NO CHARGE and NO SCORE at the cap, and never calls the provider", async () => {
    const db = freshDb();
    writeSettings(db, { monthlyBudgetUsd: 0 });
    const drill = seedDrill(db);
    const take = takeFile();
    const scorer = createFixtureScorer("clean");

    await expect(
      scoreAttempt(db, scorer, { drill, audioPath: take.path, audioSeconds: take.seconds }),
    ).rejects.toBeInstanceOf(BudgetExceededError);

    expect(scorer.calls).toHaveLength(0); // no call was made
    expect(ledgerRows(db)).toHaveLength(0); // no charge, not even a pending row
    expect(attemptCount(db)).toBe(0); // and no score
  });

  it("refuses the take that would CROSS the cap while allowing the one that fits", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();
    // Budget for exactly one 2-second assessment.
    writeSettings(db, { monthlyBudgetUsd: pronunciationCallCost(PA_MODEL, 2) });

    const first = createFixtureScorer("clean");
    await scoreAttempt(db, first, { drill, audioPath: take.path, audioSeconds: 2 });
    expect(first.calls).toHaveLength(1);

    const second = createFixtureScorer("clean");
    await expect(
      scoreAttempt(db, second, { drill, audioPath: take.path, audioSeconds: 2 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(second.calls).toHaveLength(0);
    expect(ledgerRows(db)).toHaveLength(1);
    expect(attemptCount(db)).toBe(1);
  });
});

describe("E-37 money path — settling by outcome", () => {
  it("a crash mid-call still records the incurred spend (the stale pa: lease COMMITS)", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();

    // Model a process death between reserve and finalize: the reservation is taken and
    // nothing ever settles it. (`scoreAttempt` cannot express this — a crash is
    // precisely the case where its own catch never runs.)
    const reservation = openPronunciationLease(db, "abandoned-attempt", take.seconds, 50);
    expect(reservation).not.toBeNull();
    expect(ledgerRows(db)[0].state).toBe("pending");

    // The startup sweep, after the TTL: the audio was on the wire when we died, so the
    // money must NOT vanish. It commits at the reserved amount.
    const swept = sweepStaleReservations(db, 0);
    expect(swept).toBe(1);
    const rows = ledgerRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("committed");
    expect(rows[0].cost_usd).toBeCloseTo(pronunciationCallCost(PA_MODEL, take.seconds), 10);
    void drill;
  });

  it("an ANSWERED-but-unreadable reply bills and stores no score", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();
    const scorer = createFixtureScorer("clean", {
      onCall: () => {
        throw new PronunciationParseError("200 with an unreadable body");
      },
    });

    await expect(
      scoreAttempt(db, scorer, { drill, audioPath: take.path, audioSeconds: take.seconds }),
    ).rejects.toBeInstanceOf(PronunciationParseError);

    const rows = ledgerRows(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("committed"); // Azure answered, so Azure billed
    expect(rows[0].cost_usd).toBeCloseTo(pronunciationCallCost(PA_MODEL, take.seconds), 10);
    expect(attemptCount(db)).toBe(0); // there is no score to store
  });

  it("a transport failure with no response bills NOTHING", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();
    const scorer = createFixtureScorer("clean", {
      onCall: () => {
        throw new PronunciationScorerUnavailableError("network error");
      },
    });

    await expect(
      scoreAttempt(db, scorer, { drill, audioPath: take.path, audioSeconds: take.seconds }),
    ).rejects.toBeInstanceOf(PronunciationScorerUnavailableError);

    expect(ledgerRows(db)).toHaveLength(0); // the reservation was released
    expect(attemptCount(db)).toBe(0);
  });

  it("no path double-charges: N assessments produce exactly N committed rows", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();

    for (let i = 0; i < 3; i++) {
      await scoreAttempt(db, createFixtureScorer("clean"), {
        drill,
        audioPath: take.path,
        audioSeconds: take.seconds,
      });
    }
    const rows = ledgerRows(db);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.state === "committed")).toBe(true);
    expect(new Set(rows.map((r) => r.content_hash)).size).toBe(3); // one lease per attempt
    expect(attemptCount(db)).toBe(3);
  });
});

describe("E-37 money path — nothing is spent before it can be", () => {
  it("an unavailable scorer refuses BEFORE reserving: no pending row, no call, no score", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();
    const scorer = createFixtureScorer("clean", { available: false });

    await expect(
      scoreAttempt(db, scorer, { drill, audioPath: take.path, audioSeconds: take.seconds }),
    ).rejects.toBeInstanceOf(ScorerUnavailableError);

    expect(scorer.calls).toHaveLength(0);
    expect(ledgerRows(db)).toHaveLength(0);
    expect(attemptCount(db)).toBe(0);
  });

  it("a take longer than the short-audio cap is refused before any reservation", async () => {
    const db = freshDb();
    const drill = seedDrill(db);
    const take = takeFile();
    const scorer = createFixtureScorer("clean");

    await expect(
      scoreAttempt(db, scorer, { drill, audioPath: take.path, audioSeconds: 31 }),
    ).rejects.toThrow(/at most 30s/);

    expect(scorer.calls).toHaveLength(0);
    expect(ledgerRows(db)).toHaveLength(0);
    expect(attemptCount(db)).toBe(0);
  });

  it("the tutor's sweep behaviour is unchanged — a non-assumed-run lease still releases", () => {
    const db = freshDb();
    // A plain cascade reservation (no `tutor:`/`pa:` prefix) must still release to $0
    // on sweep: a crashed bounded model call was never charged.
    db.prepare(
      "INSERT INTO spend_ledger (id, month, model, content_hash, cost_usd, state, reserved_at) " +
        "VALUES ('r1', '2026-07', 'gpt-audio-1.5', 'segment-hash', 0.5, 'pending', datetime('now', '-1 hour'))",
    ).run();
    expect(sweepStaleReservations(db, 0)).toBe(1);
    expect(ledgerRows(db)).toHaveLength(0);
  });
});
