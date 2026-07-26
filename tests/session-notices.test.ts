import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allNotices, classifyFailure, noticeFor, TRANSIENT_WORDS } from "@/lib/session/notices";
import { pageFileFor } from "./helpers";

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
    expect(softened.map((n) => n.reason).sort()).toEqual([
      "conversation-transient",
      "model-transient",
      "save-failed",
      "voice-transient",
    ]);
    for (const n of softened) expect(n.standing).toBe(false);
  });
});

// [v0.7 close sweep] The gate's finding was not that the rules were wrong — it was that
// they stopped at the session boundary. So the classifier every surface now shares is
// asserted here, on the same three rules, condition by condition.
describe("classifyFailure — one classifier for every surface", () => {
  const surfaces = ["model-transient", "voice-transient", "conversation-transient"] as const;

  it("a budget refusal is standing, links to Settings, and offers no retry", () => {
    for (const transient of surfaces) {
      const reason = classifyFailure({ budgetExceeded: true, keyConfigured: true, transient });
      expect(reason).toBe("budget");
      const notice = noticeFor(reason);
      expect(notice.standing).toBe(true);
      expect(notice.retryable).toBe(false);
      expect(notice.action?.href).toBe("/settings");
    }
  });

  it("no key at all is 'no-key' on every surface, never a transient", () => {
    for (const transient of surfaces) {
      const reason = classifyFailure({ keyConfigured: false, message: "OPENAI_API_KEY is not set.", transient });
      expect(reason).toBe("no-key");
      expect(noticeFor(reason).standing).toBe(true);
    }
  });

  // The v0.6 defect, on the v0.7 flagship: a REVOKED key reported as momentary. This is
  // the assertion that would have failed on `app/api/tutor/session/route.ts` as shipped.
  it("a key OpenAI refused is 'key-rejected' — never softened, never 'no key is set'", () => {
    for (const transient of surfaces) {
      for (const message of [
        "client_secrets mint failed: 401 Unauthorized {\"error\":{\"code\":\"invalid_api_key\"}}",
        "gpt-4o-mini-tts call failed: 403 Forbidden",
      ]) {
        const reason = classifyFailure({ keyConfigured: true, message, transient });
        expect(reason).toBe("key-rejected");
        const notice = noticeFor(reason);
        expect(notice.standing).toBe(true);
        for (const word of TRANSIENT_WORDS) expect(notice.body.toLowerCase()).not.toContain(word);
        expect(notice.action?.href).toBe("/settings");
        expect(notice.body).not.toEqual(noticeFor("no-key").body);
      }
    }
  });

  it("anything else is the surface's OWN transient — and it names what it could not reach", () => {
    expect(classifyFailure({ keyConfigured: true, message: "503 Service Unavailable", transient: "voice-transient" })).toBe(
      "voice-transient",
    );
    expect(
      classifyFailure({ keyConfigured: true, message: "network error", transient: "conversation-transient" }),
    ).toBe("conversation-transient");
    // A learner tapping Listen must not be told the LESSON model is down.
    expect(noticeFor("voice-transient").body.toLowerCase()).toContain("voice");
    expect(noticeFor("conversation-transient").body.toLowerCase()).toContain("conversation");
    for (const transient of surfaces) expect(noticeFor(transient).retryable).toBe(true);
  });

  // A 401 whose body happens to say "budget", or a keyless server whose upstream text
  // mentions 401, must land on the condition that is actually true.
  it("the order is budget → no key → refused key → momentary", () => {
    expect(
      classifyFailure({ budgetExceeded: true, keyConfigured: true, message: "401", transient: "voice-transient" }),
    ).toBe("budget");
    expect(
      classifyFailure({ keyConfigured: false, message: "401 Unauthorized", transient: "voice-transient" }),
    ).toBe("no-key");
  });
});

describe("rule 2 — a named remedy is a working link", () => {
  it("every notice that points somewhere points at a real page", () => {
    let checked = 0;
    for (const notice of allNotices()) {
      if (!notice.action) continue;
      // [E-46] See `pageFileFor`: every product page moved inside `app/(app)/`.
      const page = pageFileFor(notice.action.href);
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

  it("names the exact remedy when it lies outside the app", () => {
    // A denied microphone cannot be fixed by a link — the setting is the browser's.
    // So the copy names where it lives instead of pointing nowhere.
    const mic = noticeFor("mic-denied");
    expect(mic.action).toBeNull();
    expect(mic.retryable).toBe(true);
    expect(mic.body.toLowerCase()).toContain("microphone");
    expect(mic.body.toLowerCase()).toContain("browser");
  });

  it("distinguishes 'no key is set' from 'the key was refused'", () => {
    // Telling someone who HAS configured a key that none is set sends them to check
    // something already correct — a dead end dressed as guidance.
    expect(noticeFor("no-key").body).not.toEqual(noticeFor("key-rejected").body);
    expect(noticeFor("key-rejected").body.toLowerCase()).toContain("refused");
  });
});
