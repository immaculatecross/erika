import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArchiveRow } from "@/components/archive-row";
import { LetterRecast } from "@/components/letter-recast";
import { FindingRow, FindingNotesLine } from "@/components/analysis-report";
import type { ArchiveEntry } from "@/lib/archive";
import type { LetterFinding } from "@/lib/letter";
import type { FindingView } from "@/lib/analysis-view";

// The two RETRO-002 read-view fixes folded into E-30, at the render level
// (renderToStaticMarkup, no DOM — the initial client state is what renders):
//   P1 — finish correction-forward on Archive and the Letter (D-18): the recast
//        headlines, the error is behind a tap and genuinely absent from the DOM
//        until revealed. An erroneous form is never a primary/headline stimulus.
//   P2 — surface the richness-dial notes: a finding carrying `notes` shows them
//        as the "Erika also noticed" line in the expanded report finding.

const QUOTE = "io ho andato a casa";
const CORRECTION = "io sono andato a casa";
const WHY = "passato prossimo con essere";

describe("Archive row — correction-forward, error hidden until revealed (P1, D-18)", () => {
  const entry: ArchiveEntry = {
    findingId: "f1",
    sessionId: "s1",
    sessionCreatedAt: "2026-07-10 09:00:00",
    sessionFilename: "day.wav",
    quote: QUOTE,
    correction: CORRECTION,
    explanation: WHY,
    category: "grammar",
    severity: "high",
    startMs: 4000,
  };

  it("headlines the correction and keeps the error out of the initial DOM", () => {
    const html = renderToStaticMarkup(<ArchiveRow entry={entry} reduced={false} />);
    expect(html).toContain("data-entry-correction");
    expect(html).toContain(`“${CORRECTION}”`); // the recast leads
    expect(html).toContain("data-reveal-error"); // the tap target is present
    expect(html).not.toContain(QUOTE); // the error is genuinely absent until revealed
    expect(html).toContain('data-start-ms="4000"'); // still deep-links to the moment
  });
});

describe("Letter recast — correction-forward, error subordinate (P1, D-18)", () => {
  const recast: LetterFinding = {
    id: "r1",
    quote: QUOTE,
    correction: CORRECTION,
    explanation: WHY,
    category: "phrasing",
    severity: "medium",
  };

  it("headlines the native recast and hides the error until revealed", () => {
    const html = renderToStaticMarkup(<LetterRecast recast={recast} />);
    expect(html).toContain("data-recast-correction");
    expect(html).toContain(`“${CORRECTION}”`); // natives-say leads
    expect(html).toContain("data-reveal-error");
    expect(html).not.toContain(QUOTE); // the error is not headlined nor pre-rendered
  });
});

describe("Report finding — the richness-dial notes surface (P2, E-28 v16)", () => {
  const base: FindingView = {
    id: "x",
    quote: QUOTE,
    correction: CORRECTION,
    category: "grammar",
    explanation: WHY,
    severity: "high",
    startMs: 1000,
    endMs: 2000,
  };

  it("renders 'Erika also noticed' with each present note when expanded", () => {
    const finding: FindingView = {
      ...base,
      notes: { pronunciation: "hard c in casa", register: "andarsene reads more colto", disfluency: "false start on io" },
    };
    const html = renderToStaticMarkup(<FindingRow finding={finding} onJump={() => {}} defaultOpen />);
    expect(html).toContain("data-finding-notes");
    expect(html).toContain("Erika also noticed");
    expect(html).toContain("hard c in casa");
    expect(html).toContain("andarsene reads more colto");
    expect(html).toContain("false start on io");
  });

  it("renders nothing for a finding with no notes", () => {
    expect(renderToStaticMarkup(<FindingNotesLine notes={null} />)).toBe("");
    expect(renderToStaticMarkup(<FindingNotesLine notes={{}} />)).toBe("");
    const html = renderToStaticMarkup(<FindingRow finding={base} onJump={() => {}} defaultOpen />);
    expect(html).not.toContain("data-finding-notes");
  });
});
