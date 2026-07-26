import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { tmpDir } from "./helpers";
import { ONBOARDING_PATH, isOnboardingPath, onboardingRedirect } from "@/lib/onboarding/routing";
import type { Db } from "@/lib/db";

// E-46 criterion 1, both directions. The second one is the one that matters more.
//
// FORCE: on a database that has never met anybody, every navigable page lands in
// onboarding — including a deep link that skips the home screen entirely.
//
// NEVER TRAP: on a database that HAS met somebody, no path is ever redirected into
// onboarding. The opposite failure of the defect being fixed is a learner locked out
// of their own populated app, and it is strictly worse: the defect being fixed costs
// a new learner a calibrated day one, while the opposite costs an existing learner
// every recording they ever made. So the "complete" direction is tested exhaustively
// over the SAME route list, not with one happy-path case.
//
// The enumeration below is the real route inventory of the app, taken from `app/`, so
// a new page cannot quietly acquire an exemption: it must either be under /welcome or
// it is gated.

const EVERY_PAGE = [
  "/",
  "/archive",
  "/phrasebook",
  "/slips",
  "/slips/abc123",
  "/sessions/abc123",
  "/practice",
  "/practice/cards",
  "/practice/review",
  "/practice/reading",
  "/practice/tutor",
  "/practice/lessons",
  "/practice/lessons/some-key",
  "/practice/learn",
  "/practice/learn/lesson/rule%3Aarticoli",
  "/practice/learn/shadow",
  "/practice/learn/studio",
  "/practice/learn/studio/drill%2Fkey",
  "/focus",
  "/letter",
  "/settings",
  "/progress",
  "/a-route-that-does-not-exist-yet",
];

describe("the first-run gate forces onboarding on an empty database", () => {
  it("sends every page — including deep links — to onboarding", () => {
    for (const p of EVERY_PAGE) {
      expect(onboardingRedirect(p, false), `incomplete: ${p}`).toBe(ONBOARDING_PATH);
    }
  });

  it("exempts onboarding itself, or the redirect would loop", () => {
    expect(onboardingRedirect(ONBOARDING_PATH, false)).toBeNull();
    expect(onboardingRedirect(`${ONBOARDING_PATH}/check`, false)).toBeNull();
    expect(isOnboardingPath(ONBOARDING_PATH)).toBe(true);
    // A path that merely starts with the same letters is NOT onboarding.
    expect(isOnboardingPath("/welcomed")).toBe(false);
    expect(onboardingRedirect("/welcomed", false)).toBe(ONBOARDING_PATH);
  });

});

describe("the first-run gate never traps a learner who already has a profile", () => {
  it("lets every single page through once onboarding is complete", () => {
    for (const p of [...EVERY_PAGE, ONBOARDING_PATH, `${ONBOARDING_PATH}/check`]) {
      expect(onboardingRedirect(p, true), `complete: ${p}`).toBeNull();
    }
  });
});

describe("non-pages are never gated", () => {
  it("lets API and asset paths through in both directions", () => {
    for (const p of ["/api/learn/today", "/api/placement", "/_next/static/chunk.js", "/favicon.ico"]) {
      expect(onboardingRedirect(p, false), p).toBeNull();
      expect(onboardingRedirect(p, true), p).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The database half: what makes `complete` true. Every clause is a rescue clause,
// so each is asserted on its own — a disjunction whose branches are untested is a
// disjunction a mutation can delete.

let root: string;
let db: Db;
let onboardingComplete: typeof import("@/lib/onboarding/state").onboardingComplete;
let markOnboardingComplete: typeof import("@/lib/onboarding/state").markOnboardingComplete;
let openDatabase: typeof import("@/lib/db").openDatabase;

beforeAll(async () => {
  root = tmpDir("erika-onboarding-gate-");
  process.env.ERIKA_DB_PATH = path.join(root, "erika.db");
  process.env.ERIKA_DATA_DIR = root;
  const mod = await import("@/lib/onboarding/state");
  onboardingComplete = mod.onboardingComplete;
  markOnboardingComplete = mod.markOnboardingComplete;
  openDatabase = (await import("@/lib/db")).openDatabase;
  db = (await import("@/lib/db")).getDb();
});

function freshDb(name: string): Db {
  return openDatabase(path.join(root, `${name}.db`));
}

describe("onboardingComplete", () => {
  it("is false on a database that has never met anybody", () => {
    expect(onboardingComplete(freshDb("empty"))).toBe(false);
  });

  it("is true once the learner walks out of onboarding, even if the check wrote nothing", () => {
    // The refusal case (REVIEW-63 F1): an unmeasurable run records NO placement run and
    // seeds NO evidence, by design. Without the explicit marker that learner would be
    // held in onboarding forever with no way out but a retake.
    const d = freshDb("marker");
    expect(onboardingComplete(d)).toBe(false);
    markOnboardingComplete(d);
    expect(onboardingComplete(d)).toBe(true);
  });

  it("keeps the FIRST completion instant when marked twice", () => {
    const d = freshDb("marker-idem");
    const first = markOnboardingComplete(d, new Date("2026-01-01T00:00:00.000Z"));
    const second = markOnboardingComplete(d, new Date("2026-06-06T00:00:00.000Z"));
    expect(second).toBe(first);
    expect(first).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is true for a learner placed by an earlier build (a run, no marker)", () => {
    const d = freshDb("legacy-run");
    d.prepare("INSERT INTO placement_runs (id, level, calibrated, false_alarm_rate) VALUES (?, ?, ?, ?)").run(
      "run-1",
      "B1",
      1,
      0,
    );
    expect(onboardingComplete(d)).toBe(true);
  });

  it("is true for a pre-v27 learner (placement evidence, no run, no marker)", () => {
    const d = freshDb("legacy-evidence");
    d.prepare(
      "INSERT INTO evidence (id, item_id, source, source_ref, polarity, mode, weight) " +
        "SELECT 'ev-1', id, 'placement', NULL, 1, 'recognition', 0.3 FROM knowledge_items LIMIT 1",
    ).run();
    expect(onboardingComplete(d)).toBe(true);
  });

  it("is true for anyone who has ever recorded", () => {
    const d = freshDb("has-session");
    d.prepare(
      "INSERT INTO sessions (id, original_filename, format, size_bytes, duration_seconds) VALUES (?, ?, ?, ?, ?)",
    ).run("s-1", "x.wav", "wav", 100, 12);
    expect(onboardingComplete(d)).toBe(true);
  });

  it("is true for the pre-E-46 LEARN-ONLY learner who never recorded", () => {
    // [REVIEW-85] The person this clause exists for: completed days and an open daily
    // session, no recordings at all, and the old placement prompt dismissed. Without
    // `day_ledger`/`daily_sessions` in the disjunction they met the gate on every
    // route — recoverable, but exactly the trap this predicate is wide to avoid.
    const d = freshDb("learn-only");
    expect(onboardingComplete(d)).toBe(false);
    d.prepare("INSERT INTO day_ledger (local_day, cards_done, lessons_done) VALUES (?, ?, ?)").run(
      "2026-07-20",
      9,
      1,
    );
    expect(onboardingComplete(d)).toBe(true);
  });

  it("is true for a learner who has opened a daily session", () => {
    const d = freshDb("has-daily-session");
    d.prepare("INSERT INTO daily_sessions (local_day, steps) VALUES (?, ?)").run("2026-07-21", "[]");
    expect(onboardingComplete(d)).toBe(true);
  });

  it("the process database starts empty, so the gate is on for a real cold start", () => {
    expect(onboardingComplete(db)).toBe(false);
  });
});
