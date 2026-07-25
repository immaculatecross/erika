import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationProgress } from "@/components/tutor/conversation-progress";
import { startFailureMessage } from "@/lib/tutor/failure-message";

// Calm progress toward the minimum (E-43 criterion 6, D-24) — and the D-24 ban list
// asserted on the thing that renders, not in a comment. RETRO-004 §3: "a claim
// enforced only by prose will drift", and it did — a copy claim written to be
// undriftable passed 994/994 with the exact old false sentence restored.

function render(elapsedMs: number, minSeconds: number): string {
  return renderToStaticMarkup(<ConversationProgress elapsedMs={elapsedMs} minSeconds={minSeconds} />);
}

describe("progress toward the minimum", () => {
  it("states where you are in tabular numerals: elapsed of the minimum", () => {
    const html = render(192_000, 300); // 3:12 of 5:00
    expect(html).toContain("3:12");
    expect(html).toContain("5:00");
    expect(html).toContain("tabular");
  });

  it("fills the hairline in proportion, and never past full", () => {
    expect(render(150_000, 300)).toContain("width:50%");
    expect(render(900_000, 300)).toContain("width:100%");
    expect(render(0, 300)).toContain("width:0%");
  });

  it("swaps one factual line for another when the minimum is reached", () => {
    const html = render(300_000, 300);
    expect(html).toContain('data-met="true"');
    expect(html).toContain("Counts toward today");
  });

  it("is a progressbar with honest ARIA values", () => {
    const html = render(120_000, 300);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="120"');
    expect(html).toContain('aria-valuemax="300"');
  });

  it("degrades to a plain timer when there is no minimum", () => {
    const html = render(65_000, 0);
    expect(html).toContain("1:05");
    expect(html).not.toContain("progressbar");
  });
});

describe("D-24's ban list, asserted on the rendered surface", () => {
  const samples = [render(0, 300), render(120_000, 300), render(300_000, 300), render(900_000, 300)];

  it("never counts DOWN, warns, or says anything about leaving early", () => {
    // "No countdown, no warning, no guilt copy if the learner leaves early."
    for (const html of samples) {
      expect(html).not.toMatch(/remaining|left to go|to go\b|hurry|almost|don't stop|keep going|only .* more/i);
    }
  });

  it("has no confetti, mascot, XP, points, levels, badges or celebration", () => {
    for (const html of samples) {
      expect(html).not.toMatch(/confetti|mascot|\bXP\b|points|level up|leaderboard|badge|streak|🎉|⭐|🔥/i);
    }
  });

  it("uses only geometry and numbers — no meter, gauge, trophy or progress theatrics", () => {
    for (const html of samples) {
      expect(html).not.toMatch(/<canvas|<img|<svg|trophy|medal|reward/i);
    }
  });

  it("says nothing at all about a shortfall while the conversation is short", () => {
    const short = render(30_000, 300);
    expect(short).toContain('data-met="false"');
    expect(short).toContain("0:30");
    expect(short).not.toMatch(/not enough|too short|failed|missed/i);
  });
});

describe("a failure the learner can act on, never an internal error string", () => {
  // RETRO-004 §1: the only place a new user learned a key was required was a leaked
  // internal error on exactly this screen.
  it("names the microphone when the browser refused it", () => {
    const msg = startFailureMessage(Object.assign(new Error("x"), { name: "NotAllowedError" }), {
      keyConfigured: true,
    });
    expect(msg).toMatch(/microphone/i);
    expect(msg).not.toMatch(/NotAllowedError/);
  });

  it("names the missing key when there is no key", () => {
    const msg = startFailureMessage(new Error("client_secrets mint failed: 401 Unauthorized"), {
      keyConfigured: false,
    });
    expect(msg).toMatch(/API key/i);
    expect(msg).not.toMatch(/client_secrets|401/);
  });

  it("falls back to something a person can read, not an empty string", () => {
    expect(startFailureMessage(new Error(""), { keyConfigured: true })).toMatch(/try again/i);
    expect(startFailureMessage(undefined, null)).toMatch(/try again/i);
  });
});
