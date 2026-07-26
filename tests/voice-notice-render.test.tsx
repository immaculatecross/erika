import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NoticeLine } from "@/components/session/step-notice";
import { pageFileFor } from "./helpers";
import { noticeFor, TRANSIENT_WORDS, type NoticeReason } from "@/lib/session/notices";

// [v0.7 close sweep] The voice controls, held to E-44's three rules.
//
// The v0.7 failure-path gate drove a keyless server — which is how EVERY user arrives,
// before they have configured anything — and every Listen / Compare / Ask control
// answered "The voice is unavailable right now." A missing key is permanent until the
// operator edits a file and restarts, so the sentence was false, it named no remedy,
// and the button stayed tappable and kept failing identically. That is the v0.6 defect
// verbatim: E-44 deleted its thirteen instances inside the daily session and left every
// surface outside it standing.
//
// RETRO-004's lesson is why this file exists at all: the repair that only rewrote the
// strings drifted back, and restoring the exact false sentence passed 994/994. So the
// deletion is pinned by a source assertion, and the replacement by a render assertion.

/** What each control renders when the server says it cannot run. */
const BLOCKING: NoticeReason[] = ["no-key", "key-rejected", "budget", "voice-transient", "model-transient"];

describe("the notice a voice control renders — rule 1, never softened", () => {
  for (const reason of BLOCKING) {
    it(`${reason} renders its own condition, at its own permanence`, () => {
      const html = renderToStaticMarkup(<NoticeLine reason={reason} onRetry={() => {}} />);
      const notice = noticeFor(reason);
      expect(html).toContain(notice.body.replace(/'/g, "&#x27;"));
      if (notice.standing) {
        for (const word of TRANSIENT_WORDS) expect(html.toLowerCase()).not.toContain(word);
      }
    });
  }

  it("a keyless machine is never told the voice is unavailable 'right now'", () => {
    const html = renderToStaticMarkup(<NoticeLine reason="no-key" onRetry={() => {}} />);
    expect(html.toLowerCase()).not.toContain("right now");
    expect(html.toLowerCase()).not.toContain("just now");
    expect(html).toContain("no API key is set on this machine");
  });
});

describe("rule 2 — a named remedy is a working link", () => {
  for (const reason of ["no-key", "key-rejected", "budget"] as const) {
    it(`${reason} carries a Settings link that resolves to a page on disk`, () => {
      const html = renderToStaticMarkup(<NoticeLine reason={reason} onRetry={() => {}} />);
      expect(html).toContain('href="/settings"');
      expect(html).toContain("Open Settings");
      // Through the ROUTER's question, not the directory's — E-46 moved every product
      // page into `app/(app)/`, and a link that resolves is the point of rule 2.
      expect(fs.existsSync(pageFileFor("/settings"))).toBe(true);
    });
  }
});

describe("rule 3 — a retry only where retrying can help", () => {
  it("the cap and a missing key offer NO retry, however hard the caller pushes one", () => {
    // The gate found "Try again" on the budget branch of reading, shadow and the
    // studio: a control that re-fails identically. `NoticeLine` refuses to draw it.
    for (const reason of ["budget", "no-key"] as const) {
      const html = renderToStaticMarkup(<NoticeLine reason={reason} onRetry={() => {}} />);
      expect(html).not.toContain("Try again");
    }
  });

  it("a momentary failure does offer one", () => {
    const html = renderToStaticMarkup(<NoticeLine reason="voice-transient" onRetry={() => {}} />);
    expect(html).toContain("Try again");
  });
});

// The deletion itself, pinned. A control that grows its own copy again grows its own
// dialect of the rule, which is the defect shape this repo has now produced three times.
describe("no voice control carries its own copy any more", () => {
  const CONTROLS = ["components/listen-button.tsx", "components/compare-control.tsx", "components/ask-erika.tsx"];
  const BANNED = [
    "The voice is unavailable right now.",
    "The voice comparison is unavailable right now.",
    "Ask is unavailable right now.",
    "Monthly budget reached — raise it or wait for the month to roll over.",
  ];

  for (const file of CONTROLS) {
    it(`${file} states no failure in its own words`, () => {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      for (const line of BANNED) expect(src).not.toContain(line);
      // It reads the shared table instead.
      expect(src).toContain("NoticeLine");
    });
  }
});
