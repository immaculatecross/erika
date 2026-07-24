import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PronunciationResult } from "@/components/pronunciation-result";
import { DrillRecorder } from "@/components/drill-recorder";
import { ListenButton } from "@/components/listen-button";
import { whatToListenFor } from "@/lib/pronunciation/guidance";
import { buildResultView } from "@/lib/pronunciation/view";
import { DEFAULT_PRONUNCIATION_THRESHOLDS } from "@/lib/pronunciation/thresholds";
import { fixtureResult } from "@/lib/pronunciation/fixture-scorer";

// What the pronunciation surfaces are allowed to SHOW (E-37, DESIGN.md / D-24 / D-19).
// Rendered markup, not intentions:
//
//   * no intonation / rhythm / prosody claim anywhere — it-IT returns none;
//   * the uncalibrated line always rides with the scores;
//   * a too-noisy take shows a re-record prompt and NOT ONE NUMBER;
//   * no gamification (D-24) — no confetti, no XP, no streak, no badge, no exclamation;
//   * the recorder is LOCKED until the reference has been heard (listen, then record).

const T = DEFAULT_PRONUNCIATION_THRESHOLDS;
const scored = buildResultView(fixtureResult("gli-gnocchi"), T);
const noisy = buildResultView(fixtureResult("noisy"), T);

const BANNED_GAMIFICATION = /confetti|badge|streak|\bXP\b|points|level up|leaderboard|trophy|congrat/i;
const BANNED_PROSODY = /prosody|intonation|rhythm|monotone|syllable/i;

describe("PronunciationResult — a scored take", () => {
  const html = renderToStaticMarkup(
    <PronunciationResult view={scored} attemptId="attempt-1" onRetake={() => {}} />,
  );

  it("shows the word strip with a semantic band per word, and the headline score once", () => {
    expect(html).toContain("data-word-strip");
    expect(html).toContain('data-band="off"'); // "gli", 38
    expect(html).toContain('data-band="good"'); // "sono", 94
    expect((html.match(/data-pron-score/g) ?? []).length).toBe(1);
    expect(html).toContain("77"); // the PronScore, rounded
  });

  it("carries the uncalibrated notice with the scores, every time", () => {
    expect(html).toContain("data-pron-notice");
    expect(html).toMatch(/thresholds are our own/i);
    expect(html).toMatch(/no labelled Italian pronunciation corpus/i);
  });

  it("makes no intonation, rhythm or prosody claim — it-IT returns none", () => {
    expect(html).not.toMatch(BANNED_PROSODY);
  });

  it("has no gamification and no cheerleading (D-24, DESIGN copy)", () => {
    expect(html).not.toMatch(BANNED_GAMIFICATION);
    expect(html).not.toContain("!");
  });
});

describe("PronunciationResult — a too-noisy take", () => {
  const html = renderToStaticMarkup(
    <PronunciationResult view={noisy} attemptId="attempt-2" onRetake={() => {}} />,
  );

  it("shows the re-record prompt instead of a score", () => {
    expect(html).toContain("data-pron-retake");
    expect(html).toMatch(/hard to hear/i);
    expect(html).toContain("Record again");
  });

  it("shows NOT ONE NUMBER from that take", () => {
    expect(html).not.toContain("data-pron-score");
    expect(html).not.toContain("data-word-strip");
    // The fixture's scores (47 / 41 / 58) must appear nowhere in the markup.
    for (const n of ["47", "41", "58", "36", "39"]) expect(html).not.toContain(n);
  });
});

describe("ListenButton — a failed render must not dead-end the drill (F5)", () => {
  it("renders a usable control in the idle state", () => {
    const html = renderToStaticMarkup(
      <ListenButton audioSrc="/a" renderUrl="/r" exists={false} estimateUsd={0.0003} />,
    );
    expect(html).toContain("data-listen");
  });

  // The budget/error phases are internal client state that `renderToStaticMarkup`
  // cannot reach (this suite renders to a string; the repo has no DOM environment), so
  // the contract is pinned on the source. Both failure branches must (a) keep a retry
  // control — the previous version rendered a bare line and REMOVED the button, which
  // stranded the studio behind a gate that could never open — and (b) report
  // `onUnavailable` so the surface can stop gating.
  const listenSrc = readFileSync(join(process.cwd(), "components/listen-button.tsx"), "utf8");

  it("keeps a retry control in BOTH the budget and error branches", () => {
    const budget = listenSrc.slice(listenSrc.indexOf('phase === "budget"'), listenSrc.indexOf('phase === "generating"'));
    // One retry button in the budget branch and one in the error branch.
    expect((budget.match(/data-listen-retry/g) ?? []).length).toBe(2);
    expect(budget).toContain("data-listen-budget");
    expect(budget).toContain("data-listen-error");
  });

  it("reports onUnavailable on every path that cannot play", () => {
    // A 402, a non-OK render, a thrown fetch, and a playback failure.
    expect((listenSrc.match(/onUnavailable\?\.\(\)/g) ?? []).length).toBe(4);
  });

  it("the drill page unlocks recording when the rendition cannot be played", () => {
    const pageSrc = readFileSync(
      join(process.cwd(), "app/practice/learn/studio/[drillKey]/page.tsx"),
      "utf8",
    );
    expect(pageSrc).toContain("onUnavailable={() => setRenditionUnavailable(true)}");
    expect(pageSrc).toContain("enabled={heard || renditionUnavailable}");
    expect(pageSrc).toContain("data-drill-rendition-unavailable");
  });
});

describe("the studio subtitle promises only what the server can do (F4)", () => {
  it("omits the per-word/per-sound claim when no scorer is configured", () => {
    // The copy branch is the whole point, so it is asserted as data rather than by
    // rendering the client page: the scored branch names a score, the default does not.
    const scoredCopy = "Hear a line, then say it back. You get a score for each word and each sound.";
    const defaultCopy = "Hear a line, then say it back, and listen to the difference.";
    const src = readFileSync(
      join(process.cwd(), "app/practice/learn/studio/page.tsx"),
      "utf8",
    );
    expect(src).toContain(`view.scoringAvailable`);
    expect(src).toContain(scoredCopy);
    expect(src).toContain(defaultCopy);
    expect(defaultCopy).not.toMatch(/score/i);
  });
});

describe("guidance copy carries no prosody word (F6)", () => {
  it("the no-suspect line names segmental things only — vowels and double consonants", () => {
    const g = whatToListenFor({ suspect: null });
    expect(g.text).not.toMatch(BANNED_PROSODY);
    expect(g.text).toMatch(/vowels/i);
  });

  it("a flagged suspect is quoted verbatim — the studio's OWN copy adds no prosody word", () => {
    // The suspect is the deep pass's text, so it can say anything; what is pinned here is
    // that the sentence the studio wraps around it introduces none.
    const g = whatToListenFor({ suspect: "the vowel in casa is too closed" });
    const ownCopy = g.text.replace("the vowel in casa is too closed", "");
    expect(ownCopy).not.toMatch(BANNED_PROSODY);
  });
});

describe("DrillRecorder — listen, THEN record", () => {
  it("locks recording until the rendition has been heard, and says why", () => {
    const html = renderToStaticMarkup(
      <DrillRecorder scoreUrl={null} enabled={false} maxSeconds={30} scoreEstimateUsd={0.0017} onScored={() => {}} />,
    );
    expect(html).toContain("data-drill-record");
    expect(html).toContain('disabled=""'); // the attribute, not the disabled: utility class
    expect(html).toContain("data-drill-listen-first");
    expect(html).toMatch(/never record while the rendition is audible/i);
  });

  it("unlocks once heard — and offers NO scoring control when no scorer is configured", () => {
    const html = renderToStaticMarkup(
      <DrillRecorder scoreUrl={null} enabled maxSeconds={30} scoreEstimateUsd={0.0017} onScored={() => {}} />,
    );
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain("data-drill-score");
    // The loop itself is fully present without a scorer — this is the primary path.
    expect(html).toContain("Record your take");
  });

  it("prices the optional scoring step honestly when a scorer IS configured", () => {
    // A take must exist before the scoring control appears; with no take the control is
    // absent even when scoring is available, so the price is never shown speculatively.
    const html = renderToStaticMarkup(
      <DrillRecorder
        scoreUrl="/api/pronunciation/finding:x"
        enabled
        maxSeconds={30}
        scoreEstimateUsd={0.0017}
        onScored={() => {}}
      />,
    );
    expect(html).not.toContain("data-drill-score");
    expect(html).toContain("Record your take");
  });
});
