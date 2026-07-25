import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PronunciationResult } from "@/components/pronunciation-result";
import { DrillRecorder } from "@/components/drill-recorder";
import { ListenButton } from "@/components/listen-button";
import { whatToListenFor } from "@/lib/pronunciation/guidance";
import {
  drillGate,
  drillFitsShortAudio,
  shouldReportLap,
  MAX_DRILL_REFERENCE_CHARS,
} from "@/lib/pronunciation/types";
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

describe("the drill gate — recording vs SPENDING the finding", () => {
  // These two decisions collided once and shipped a defect: F5 unlocked recording when
  // the rendition could not play, F1 made a completed lap retire the finding, and their
  // intersection let a budget-refused render retire a correction the learner had never
  // heard. The pair is now one pure function, tested as a truth table.

  it("normal path: heard the line ⇒ can record, and the lap spends the finding", () => {
    expect(drillGate({ heard: true, renditionUnavailable: false, renditionImpossible: false })).toEqual({
      canRecord: true,
      visitCounts: true,
    });
  });

  it("[N1] rendition unavailable and NOT heard ⇒ can record, but the lap must NOT count", () => {
    // The whole defect in one assertion: practice stays available (F5), and the
    // correction is not silently retired without ever being compared to the reference.
    expect(drillGate({ heard: false, renditionUnavailable: true, renditionImpossible: false })).toEqual({
      canRecord: true,
      visitCounts: false,
    });
  });

  it("nothing heard and nothing failed ⇒ recording is still locked (listen first)", () => {
    expect(drillGate({ heard: false, renditionUnavailable: false, renditionImpossible: false })).toEqual({
      canRecord: false,
      visitCounts: false,
    });
  });

  it("heard it, and a LATER render failed ⇒ the lap still counts (they did hear it)", () => {
    expect(drillGate({ heard: true, renditionUnavailable: true, renditionImpossible: false })).toEqual({
      canRecord: true,
      visitCounts: true,
    });
  });

  it("is the whole truth table, asserted positively over every combination", () => {
    // [E-39] This used to be `if (g.visitCounts) expect(g.canRecord).toBe(true)` — an
    // implication a mutation making `visitCounts` always false satisfies VACUOUSLY, since
    // the body never runs (RETRO-004 §1.4 V3). The expectation now comes from this table,
    // stated independently of the function, and every one of the eight inputs is named.
    const table: {
      heard: boolean;
      renditionUnavailable: boolean;
      renditionImpossible: boolean;
      canRecord: boolean;
      visitCounts: boolean;
    }[] = [
      // Heard the line: record, and the lap spends the finding. The normal path.
      { heard: true, renditionUnavailable: false, renditionImpossible: false, canRecord: true, visitCounts: true },
      { heard: true, renditionUnavailable: true, renditionImpossible: false, canRecord: true, visitCounts: true },
      { heard: true, renditionUnavailable: false, renditionImpossible: true, canRecord: true, visitCounts: true },
      { heard: true, renditionUnavailable: true, renditionImpossible: true, canRecord: true, visitCounts: true },
      // Never heard it, and the line COULD have played: practise, spend nothing.
      { heard: false, renditionUnavailable: false, renditionImpossible: false, canRecord: false, visitCounts: false },
      { heard: false, renditionUnavailable: true, renditionImpossible: false, canRecord: true, visitCounts: false },
      // Never heard it, and this server can NEVER play it: the reduced loop IS the drill,
      // so it must be able to retire the finding (E-39 §B4) — otherwise the finding, which
      // gets no card either, returns to the plan every day forever.
      { heard: false, renditionUnavailable: false, renditionImpossible: true, canRecord: true, visitCounts: true },
      { heard: false, renditionUnavailable: true, renditionImpossible: true, canRecord: true, visitCounts: true },
    ];
    expect(table).toHaveLength(8); // every combination of three booleans, none omitted

    for (const row of table) {
      const { canRecord, visitCounts, ...input } = row;
      expect({ ...input, ...drillGate(input) }).toEqual({ ...input, canRecord, visitCounts });
      // And the standing structural rule: a spendable lap is always a legal one.
      expect(canRecord || !visitCounts).toBe(true);
    }
  });

  it("the drill page hands the recorder the gate's decisions, not its own", () => {
    // A wiring smoke, not the invariant — the invariant is the truth table above. The
    // repo renders to a string with no DOM, so the JSX binding itself is checked here.
    const pageSrc = readFileSync(
      join(process.cwd(), "app/practice/learn/studio/[drillKey]/page.tsx"),
      "utf8",
    );
    expect(pageSrc).toContain("enabled={gate.canRecord}");
    expect(pageSrc).toContain("onCycleComplete={gate.visitCounts ? onCycleComplete : undefined}");
  });
});

describe("the lap latch — a blind lap must not disarm the take (B2)", () => {
  // [B2] `playMine` burnt the per-take latch BEFORE checking whether the lap could be
  // reported. During an unheard blind lap the parent deliberately passes no callback (the
  // N1 gate), so the latch was spent for nothing — and when the rendition recovered and
  // the learner genuinely heard the line and compared, that real lap was silently dropped
  // and the correction could never be spent without re-recording. F1's forever-loop,
  // reachable through the newest repair.

  /** The recorder's own sequence: a latch that is spent only by a reportable lap. */
  function lapper() {
    let latch = false;
    return {
      lap(canReport: boolean): boolean {
        if (shouldReportLap({ canReport, alreadyReported: latch })) {
          latch = true;
          return true;
        }
        return false;
      },
      get spent() {
        return latch;
      },
    };
  }

  it("does not report, and does not SPEND the latch, when the lap cannot be reported", () => {
    expect(shouldReportLap({ canReport: false, alreadyReported: false })).toBe(false);
    const r = lapper();
    expect(r.lap(false)).toBe(false);
    expect(r.spent).toBe(false); // still armed — this is the whole fix
  });

  it("reports the first reportable lap and then latches", () => {
    expect(shouldReportLap({ canReport: true, alreadyReported: false })).toBe(true);
    expect(shouldReportLap({ canReport: true, alreadyReported: true })).toBe(false);
  });

  it("[B2] blind lap, then hear the line, then compare — the genuine lap IS reported", () => {
    const r = lapper();

    // The rendition failed. F5 unlocks recording; the N1 gate passes no callback.
    const blind = drillGate({ heard: false, renditionUnavailable: true, renditionImpossible: false });
    expect(blind.canRecord).toBe(true);
    expect(r.lap(blind.visitCounts)).toBe(false);
    expect(r.spent).toBe(false);

    // The rendition recovers, the learner hears the line, and compares again.
    const heard = drillGate({ heard: true, renditionUnavailable: false, renditionImpossible: false });
    expect(r.lap(heard.visitCounts)).toBe(true); // the lap that must count
    expect(r.spent).toBe(true);

    // A second press on the same take still reports only once.
    expect(r.lap(heard.visitCounts)).toBe(false);
  });

  it("many blind laps never exhaust the take's one real lap", () => {
    const r = lapper();
    for (let i = 0; i < 5; i++) expect(r.lap(false)).toBe(false);
    expect(r.lap(true)).toBe(true);
  });

  it("the recorder spends the latch only through shouldReportLap", () => {
    const src = readFileSync(join(process.cwd(), "components/drill-recorder.tsx"), "utf8");
    expect(src).toContain("shouldReportLap({ canReport: !!onCycleComplete");
    // A wiring smoke; the invariant is the sequence test above.
    expect(src).not.toContain("if (!cycleReported.current) {");
  });
});

describe("ListenButton — a failed render must not dead-end the drill (F5)", () => {
  it("renders a usable control in the idle state", () => {
    const html = renderToStaticMarkup(
      <ListenButton audioSrc="/a" renderUrl="/r" exists={false} estimateUsd={0.0003} />,
    );
    expect(html).toContain("data-listen");
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
