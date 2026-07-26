import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { ONBOARDING_PATH } from "@/lib/onboarding/routing";
import { pageFileFor } from "./helpers";
import {
  completionSentence,
  describeSession,
  homeAction,
  isStepKey,
  orderSteps,
  STEP_ORDER,
} from "@/lib/session/steps";

// The session's pure vocabulary (E-44). These are the sentences the whole milestone
// is judged on — the one factual line describing the day and the one factual line
// closing it — so they are tested as specifications, not as strings.

describe("step ordering — one linear session, never a menu", () => {
  it("runs lesson → drills → letter → conversation", () => {
    expect([...STEP_ORDER]).toEqual(["lesson", "drills", "letter", "conversation"]);
  });

  it("normalises any assembled or persisted list into that order, deduplicated", () => {
    expect(orderSteps(["conversation", "lesson", "drills", "lesson"])).toEqual([
      "lesson",
      "drills",
      "conversation",
    ]);
  });

  it("drops anything that is not a step, so a corrupt row cannot inject a screen", () => {
    expect(orderSteps(["lesson", "quiz", 7, null])).toEqual(["lesson"]);
    expect(isStepKey("quiz")).toBe(false);
    expect(isStepKey("drills")).toBe(true);
  });
});

describe("describeSession — the one factual line the home states", () => {
  it("names what today holds, in the work order's own shape", () => {
    expect(
      describeSession({
        steps: ["lesson", "drills", "conversation"],
        lessonLabel: "the congiuntivo",
        cards: 12,
      }),
    ).toBe("A lesson on the congiuntivo, 12 cards, and a conversation.");
  });

  it("counts one card as one card", () => {
    expect(describeSession({ steps: ["lesson", "drills"], lessonLabel: "elision", cards: 1 })).toBe(
      "A lesson on elision, and one card.",
    );
  });

  it("describes a recording-less day as a real day, not an empty one", () => {
    // D-27's case: nothing recorded, so no cards — the drills step is the syllabus
    // item's own exercises, and the sentence must not read like an apology.
    expect(
      describeSession({ steps: ["lesson", "drills", "conversation"], lessonLabel: "elision", cards: 0 }),
    ).toBe("A lesson on elision, a short drill, and a conversation.");
  });

  it("includes the letter when it is a step this week", () => {
    expect(
      describeSession({ steps: ["lesson", "drills", "letter"], lessonLabel: "elision", cards: 3 }),
    ).toBe("A lesson on elision, 3 cards, and your letter for the week.");
  });

  it("says so plainly when there is nothing at all", () => {
    expect(describeSession({ steps: [], lessonLabel: null, cards: 0 })).toBe(
      "Nothing left to teach you today.",
    );
  });
});

describe("completionSentence — one factual beat, once a day (D-24)", () => {
  it("states what was done, mirroring the day's promise", () => {
    expect(completionSentence({ cardsDone: 12, lessonsDone: 1, conversation: true })).toBe(
      "Done for today. One lesson, 12 cards, and a conversation.",
    );
  });

  it("matches DESIGN's own example shape when there was no conversation", () => {
    expect(completionSentence({ cardsDone: 9, lessonsDone: 1, conversation: false })).toBe(
      "Done for today. One lesson, and 9 cards.",
    );
  });

  it("omits what did not happen rather than reporting a zero", () => {
    expect(completionSentence({ cardsDone: 0, lessonsDone: 1, conversation: false })).toBe(
      "Done for today. One lesson.",
    );
    expect(completionSentence({ cardsDone: 0, lessonsDone: 0, conversation: false })).toBe(
      "Done for today.",
    );
  });

  it("never cheers, never exclaims, and never grades the learner (D-24 ban list)", () => {
    const sentences = [
      completionSentence({ cardsDone: 12, lessonsDone: 1, conversation: true }),
      completionSentence({ cardsDone: 0, lessonsDone: 0, conversation: false }),
      describeSession({ steps: ["lesson", "drills"], lessonLabel: "elision", cards: 4 }),
    ];
    for (const s of sentences) {
      expect(s).not.toMatch(/!/);
      expect(s.toLowerCase()).not.toMatch(/great|well done|nice|awesome|streak|xp|points|level up|badge|keep it up/);
    }
  });
});

describe("homeAction — there is never more than one control", () => {
  const base = { placed: true, started: false, complete: false, hasSteps: true };

  it("offers Start today before the session is opened", () => {
    expect(homeAction(base)).toEqual({ kind: "start", href: "/practice/session", label: "Start today" });
  });

  it("offers Continue once it is open", () => {
    expect(homeAction({ ...base, started: true })).toEqual({
      kind: "continue",
      href: "/practice/session",
      label: "Continue",
    });
  });

  it("offers NOTHING once the day is done — the sentence is the whole surface", () => {
    expect(homeAction({ ...base, started: true, complete: true })).toEqual({ kind: "none" });
  });

  it("asks an unplaced learner for their level first, and that is still ONE action", () => {
    const action = homeAction({ ...base, placed: false });
    expect(action.kind).toBe("place");
    expect(action).toHaveProperty("href", ONBOARDING_PATH);
  });

  it("offers nothing rather than a broken Start when there are no steps", () => {
    expect(homeAction({ ...base, hasSteps: false })).toEqual({ kind: "none" });
  });

  // [E-46, REVIEW-85] THE INVARIANT, not the instance.
  //
  // The defect: E-46 deleted `/practice/placement` and this module went on pointing at
  // it, so the one screen with one action offered a 404 — and two tests pinned the dead
  // href as the specification, which is how a defect becomes a contract. Repointing it
  // fixes today's instance; this fixes the class.
  //
  // Every state the home can be in is enumerated (2^4 over the four booleans, so a new
  // branch cannot hide from it), every href the action can carry is collected, and each
  // one is resolved to a `page.tsx` on disk through `pageFileFor`, which understands the
  // `app/(app)/` route group. A route deleted out from under this module is now a red
  // test rather than a dead end on the most important screen in the product.
  it("every href the one action can return resolves to a real page", () => {
    const flags = [false, true];
    const hrefs = new Set<string>();
    for (const placed of flags) {
      for (const started of flags) {
        for (const complete of flags) {
          for (const hasSteps of flags) {
            const action = homeAction({ placed, started, complete, hasSteps });
            if (action.kind !== "none") hrefs.add(action.href);
          }
        }
      }
    }
    expect(hrefs.size).toBeGreaterThan(0);
    for (const href of hrefs) {
      const page = pageFileFor(href);
      expect(fs.existsSync(page), `${href} → ${page}`).toBe(true);
    }
  });

  it("sends an unplaced learner into onboarding, which is the check plus its escape", () => {
    // The learner who lands here is onboarded-but-unplaced: a check refused as a
    // response style records no run and seeds nothing, by design. Onboarding is where
    // the spoken sample lives, which is their actual way out of that refusal.
    const action = homeAction({ ...base, placed: false });
    expect(action).toHaveProperty("href", ONBOARDING_PATH);
    expect(fs.existsSync(pageFileFor(ONBOARDING_PATH))).toBe(true);
  });
});
