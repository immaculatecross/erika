import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allNotices, noticeFor, TRANSIENT_WORDS } from "@/lib/session/notices";

// CRITERION 3, MECHANISED. RETRO-004 named the same defect thirteen times: every row
// on the Learn home led to "The lesson model is unavailable right now" — false for a
// permanent condition — with no retry control, and the budget branch said "raise the
// cap in Settings" beside no link at all.
//
// The repair that only rewrote the strings would drift back. These are the three rules
// as executable assertions, so the copy cannot quietly revert:
//   1. A STANDING condition is never softened with "right now" or "just now".
//   2. A named remedy is a WORKING link — asserted against `app/` on disk.
//   3. A retry is offered exactly where retrying can help.

describe("rule 1 — a standing condition is never called 'right now'", () => {
  for (const notice of allNotices()) {
    if (!notice.standing) continue;
    it(`${notice.reason} states a permanent condition permanently`, () => {
      for (const word of TRANSIENT_WORDS) {
        expect(notice.body.toLowerCase()).not.toContain(word);
      }
    });
  }

  it("only the genuinely momentary conditions may use that wording at all", () => {
    const softened = allNotices().filter((n) =>
      TRANSIENT_WORDS.some((w) => n.body.toLowerCase().includes(w)),
    );
    expect(softened.map((n) => n.reason).sort()).toEqual(["model-transient", "save-failed"]);
    for (const n of softened) expect(n.standing).toBe(false);
  });
});

describe("rule 2 — a named remedy is a working link", () => {
  it("every notice that points somewhere points at a real page", () => {
    const root = path.join(process.cwd(), "app");
    let checked = 0;
    for (const notice of allNotices()) {
      if (!notice.action) continue;
      const page = path.join(root, notice.action.href.replace(/^\//, ""), "page.tsx");
      expect(fs.existsSync(page), `${notice.reason} → ${notice.action.href}`).toBe(true);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a notice that MENTIONS Settings also LINKS to Settings", () => {
    // The exact defect: "raise the cap in Settings" shipped as prose beside no link.
    for (const notice of allNotices()) {
      if (!/settings/i.test(notice.body)) continue;
      expect(notice.action, `${notice.reason} mentions Settings`).not.toBeNull();
      expect(notice.action?.href).toBe("/settings");
    }
  });
});

describe("rule 3 — a retry is offered where retrying can help", () => {
  it("the momentary conditions are retryable; the standing ones do not pretend", () => {
    expect(noticeFor("model-transient").retryable).toBe(true);
    expect(noticeFor("in-flight").retryable).toBe(true);
    expect(noticeFor("save-failed").retryable).toBe(true);
    // Retrying a missing key or a spent budget changes nothing; offering the control
    // would be the "present but does nothing" failure, which is worse than none.
    expect(noticeFor("no-key").retryable).toBe(false);
    expect(noticeFor("budget").retryable).toBe(false);
  });

  it("every notice offers SOMETHING — a link, a retry, or an honest end", () => {
    for (const notice of allNotices()) {
      const hasWayForward = notice.retryable || notice.action !== null;
      // The three that legitimately offer neither are the ones where nothing is
      // wrong and nothing is owed: there is no card due, nothing new to teach, or
      // this build cannot record a conversation. Each says so as a fact.
      const isHonestEnd = ["no-cards", "nothing-to-teach", "not-recorded"].includes(notice.reason);
      expect(hasWayForward || isHonestEnd, notice.reason).toBe(true);
    }
  });
});

describe("the copy is Erika's voice (DESIGN)", () => {
  it("is quiet and exact — no exclamation, no apology, no blame", () => {
    for (const notice of allNotices()) {
      expect(notice.body).not.toMatch(/!/);
      expect(notice.body.toLowerCase()).not.toMatch(/sorry|oops|unfortunately|failed to|error/);
      expect(notice.body.length).toBeGreaterThan(20);
    }
  });

  it("distinguishes 'no key is set' from 'the key was refused'", () => {
    // Telling someone who HAS configured a key that none is set sends them to check
    // something already correct — a dead end dressed as guidance.
    expect(noticeFor("no-key").body).not.toEqual(noticeFor("key-rejected").body);
    expect(noticeFor("key-rejected").body.toLowerCase()).toContain("refused");
  });
});
