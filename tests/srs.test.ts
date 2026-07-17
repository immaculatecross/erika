import { describe, expect, it } from "vitest";
import { schedule, FRESH, MIN_EASE, type Grade, type SrsState } from "@/lib/srs";

// The pure SM-2 scheduler (E-5 criterion 2). No DB — just the state → grade →
// state mapping, exercised across all four grades from a fresh card and from a
// review state, plus the SM-2 invariants: Again resets, Easy lengthens most, ease
// stays floored at 1.3.

describe("schedule — from a fresh card", () => {
  it("advances the interval on each passing grade and resets on Again", () => {
    for (const grade of ["hard", "good", "easy"] as Grade[]) {
      const r = schedule(FRESH, grade);
      expect(r.repetitions).toBe(1);
      expect(r.intervalDays).toBe(1); // first successful review → 1 day
      expect(r.lastGrade).toBe(grade);
    }
    const again = schedule(FRESH, "again");
    expect(again.repetitions).toBe(0); // lapse keeps the streak at zero
    expect(again.intervalDays).toBe(0); // due again immediately
  });

  it("moves ease the SM-2 way per grade (down for again/hard, flat good, up easy)", () => {
    expect(schedule(FRESH, "again").ease).toBeCloseTo(2.5 - 0.32, 5);
    expect(schedule(FRESH, "hard").ease).toBeCloseTo(2.5 - 0.14, 5);
    expect(schedule(FRESH, "good").ease).toBeCloseTo(2.5, 5);
    expect(schedule(FRESH, "easy").ease).toBeCloseTo(2.5 + 0.1, 5);
  });
});

describe("schedule — from a review state", () => {
  const reviewed: SrsState = { ease: 2.5, intervalDays: 20, repetitions: 5 };

  it("Easy lengthens most, then Good, then Hard — strictly ordered", () => {
    const hard = schedule(reviewed, "hard").intervalDays;
    const good = schedule(reviewed, "good").intervalDays;
    const easy = schedule(reviewed, "easy").intervalDays;
    expect(easy).toBeGreaterThan(good);
    expect(good).toBeGreaterThan(hard);
    expect(hard).toBeGreaterThan(reviewed.intervalDays); // even Hard still grows
  });

  it("Again resets the interval and repetitions and reduces ease", () => {
    const r = schedule(reviewed, "again");
    expect(r.intervalDays).toBe(0);
    expect(r.repetitions).toBe(0);
    expect(r.ease).toBeCloseTo(2.5 - 0.32, 5);
    expect(r.ease).toBeLessThan(reviewed.ease);
  });
});

describe("schedule — invariants", () => {
  it("grows the interval monotonically under repeated Good, and faster under Easy", () => {
    let good = FRESH;
    let easy = FRESH;
    let prevGood = -1;
    let prevEasy = -1;
    for (let n = 0; n < 8; n++) {
      good = schedule(good, "good");
      easy = schedule(easy, "easy");
      expect(good.intervalDays).toBeGreaterThan(prevGood);
      expect(easy.intervalDays).toBeGreaterThan(prevEasy);
      prevGood = good.intervalDays;
      prevEasy = easy.intervalDays;
    }
    expect(easy.intervalDays).toBeGreaterThan(good.intervalDays); // Easy pulls ahead
  });

  it("floors ease at 1.3 no matter how many times Again is pressed", () => {
    let state: SrsState = { ease: 1.4, intervalDays: 10, repetitions: 3 };
    for (let n = 0; n < 20; n++) {
      state = schedule(state, "again");
      expect(state.ease).toBeGreaterThanOrEqual(MIN_EASE);
    }
    expect(state.ease).toBeCloseTo(MIN_EASE, 5); // pinned exactly at the floor
  });
});
