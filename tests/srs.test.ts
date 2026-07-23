import { describe, expect, it } from "vitest";
import {
  schedule,
  retrievability,
  easeToDifficulty,
  difficultyToEase,
  seedStability,
  FRESH,
  MIN_EASE,
  MAX_EASE,
  type Grade,
  type SrsState,
} from "@/lib/srs";

// The pure FSRS-6 scheduler wrapper (E-25, replacing the SM-2 core of E-5). No DB —
// just the state → grade → state mapping, exercised across all four grades from a
// fresh card and from a seeded review state, plus the invariants the drill relies
// on: Again resets and returns the card this session, a pass schedules ≥1 day out,
// Easy > Good > Hard, and the ease↔difficulty seed mapping round-trips.

describe("schedule — from a fresh card", () => {
  it("schedules every passing grade at least a day out and returns Again this session", () => {
    for (const grade of ["hard", "good", "easy"] as Grade[]) {
      const r = schedule(FRESH, grade);
      expect(r.repetitions).toBe(1);
      expect(r.intervalDays).toBeGreaterThanOrEqual(1); // a pass leaves the day queue
      expect(r.lastGrade).toBe(grade);
    }
    const again = schedule(FRESH, "again");
    expect(again.repetitions).toBe(0); // lapse keeps the streak at zero
    expect(again.intervalDays).toBe(0); // and forces the card due again this session
  });

  it("orders the fresh intervals Easy > Good > Hard", () => {
    const hard = schedule(FRESH, "hard").intervalDays;
    const good = schedule(FRESH, "good").intervalDays;
    const easy = schedule(FRESH, "easy").intervalDays;
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThanOrEqual(hard);
  });
});

describe("schedule — from a seeded review state", () => {
  // A card seeded from SM-2 columns: a 20-day interval, mid ease, five reviews.
  const reviewed: SrsState = { ease: 2.5, intervalDays: 20, repetitions: 5 };

  it("Easy lengthens most, then Good, then Hard — strictly ordered and growing", () => {
    const hard = schedule(reviewed, "hard").intervalDays;
    const good = schedule(reviewed, "good").intervalDays;
    const easy = schedule(reviewed, "easy").intervalDays;
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThan(reviewed.intervalDays); // even Hard still grows from 20d
    expect(schedule(reviewed, "good").repetitions).toBe(6);
  });

  it("Again resets the interval and repetitions and makes the card harder (lower ease)", () => {
    const r = schedule(reviewed, "again");
    expect(r.intervalDays).toBe(0);
    expect(r.repetitions).toBe(0);
    expect(r.ease).toBeLessThan(reviewed.ease); // a miss raises FSRS difficulty → lower ease
    expect(r.ease).toBeGreaterThanOrEqual(MIN_EASE);
  });
});

describe("schedule — invariants", () => {
  it("grows the Good interval monotonically and keeps Easy ahead of Good", () => {
    let good = FRESH;
    let easy = FRESH;
    let prevGood = -1;
    for (let n = 0; n < 6; n++) {
      good = schedule(good, "good");
      easy = schedule(easy, "easy");
      expect(good.intervalDays).toBeGreaterThan(prevGood);
      prevGood = good.intervalDays;
    }
    expect(easy.intervalDays).toBeGreaterThanOrEqual(good.intervalDays); // Easy pulls ahead
  });

  it("keeps ease within the seed bounds no matter how many times Again is pressed", () => {
    let state: SrsState = { ease: 1.4, intervalDays: 10, repetitions: 3 };
    for (let n = 0; n < 20; n++) {
      state = schedule(state, "again");
      expect(state.ease).toBeGreaterThanOrEqual(MIN_EASE);
      expect(state.ease).toBeLessThanOrEqual(MAX_EASE);
    }
  });
});

describe("state seeding (SM-2 columns → FSRS)", () => {
  it("maps ease 1.3–3.0 linearly onto difficulty 10→1 and back (round-trips)", () => {
    expect(easeToDifficulty(MIN_EASE)).toBeCloseTo(10, 6);
    expect(easeToDifficulty(MAX_EASE)).toBeCloseTo(1, 6);
    for (const ease of [1.3, 1.8, 2.5, 3.0]) {
      expect(difficultyToEase(easeToDifficulty(ease))).toBeCloseTo(ease, 6);
    }
    // Higher ease (easier card) is lower difficulty.
    expect(easeToDifficulty(2.8)).toBeLessThan(easeToDifficulty(1.5));
  });

  it("seeds stability from the interval with a positive floor", () => {
    expect(seedStability(20)).toBe(20); // S ≈ interval
    expect(seedStability(0)).toBeGreaterThan(0); // a due-now card still gets a valid S
  });
});

describe("retrievability R(t, S)", () => {
  it("is 1 at t=0, ~0.9 at t=S, and decays monotonically", () => {
    expect(retrievability(10, 0)).toBeCloseTo(1, 6);
    expect(retrievability(10, 10)).toBeCloseTo(0.9, 2); // S is the 90%-retention horizon
    expect(retrievability(10, 100)).toBeLessThan(retrievability(10, 10));
    expect(retrievability(10, 100)).toBeGreaterThan(0);
    expect(retrievability(10, 100)).toBeLessThan(1);
  });
});
