import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Flashcard } from "@/components/flashcard";
import { FindingRow } from "@/components/analysis-report";
import { RevealableError } from "@/components/revealable-error";
import { deriveFaces } from "@/lib/cards-view";
import type { FindingView } from "@/lib/analysis-view";

// Correction-forward, error-once at the render level (E-29, D-18). Rendered with
// `renderToStaticMarkup` (no DOM), the node harness the other render tests use:
// effects that need `window` (usePrefersReducedMotion) do not run, so a component's
// initial state renders. State that only a click would change is seeded through a
// prop (`flipped`, `defaultOpen`, `defaultRevealed`) so both states are testable.

const QUOTE = "io ho andato a casa";
const CORRECTION = "io sono andato a casa";
const WHY = "passato prossimo con essere";

describe("Flashcard back — the correction leads, the error is shown once and marked (criterion 1)", () => {
  it("omits the raw error from the front and marks it on the back, with Compare intact (criterion 5)", () => {
    const faces = deriveFaces(QUOTE, CORRECTION, WHY, "grammar");
    expect(faces.front).not.toContain(QUOTE); // the front is never the error (D-18)

    const html = renderToStaticMarkup(
      <Flashcard
        front={faces.front}
        correction={faces.correction}
        why={faces.why}
        error={faces.error}
        category="grammar"
        flipped
        findingId="f1"
      />,
    );

    expect(html).toContain(faces.front); // the meaning-first cue is on the front
    expect(html).toContain(`“${CORRECTION}”`); // the correct form headlines the back
    expect(html).toContain("data-card-error"); // the error appears, once…
    expect(html).toMatch(/data-card-error[^>]*line-through[^>]*text-severe|data-card-error[^>]*text-severe[^>]*line-through/);
    expect(html).toContain(QUOTE); // …present, but only inside the marked back line
    expect(html).toContain("data-compare"); // Compare (E-21) still rides the back — unchanged
  });
});

describe("Session report — correction-first, the quote shown once beneath (criterion 3)", () => {
  const finding: FindingView = {
    id: "x",
    quote: QUOTE,
    correction: CORRECTION,
    category: "grammar",
    explanation: WHY,
    severity: "high",
    startMs: 1000,
    endMs: 2000,
  };

  it("leads collapsed rows with the correction and hides the error until it is expanded", () => {
    const html = renderToStaticMarkup(<FindingRow finding={finding} onJump={() => {}} />);
    expect(html).toContain("data-finding-correction");
    expect(html).toContain(`“${CORRECTION}”`); // the row leads with the correction
    expect(html).not.toContain(QUOTE); // the error is not shown until feedback (expand)
  });

  it("when expanded, the correction precedes the marked error, shown once", () => {
    const html = renderToStaticMarkup(<FindingRow finding={finding} onJump={() => {}} defaultOpen />);
    expect(html.indexOf(CORRECTION)).toBeLessThan(html.indexOf(QUOTE)); // correction first
    expect(html).toMatch(/data-finding-error[^>]*line-through/); // the quote is marked as error
    expect(html.split(QUOTE).length - 1).toBe(1); // exactly once — the one confrontation
  });
});

describe("Phrasebook reveal — the error is hidden by default, revealed on demand (criterion 4)", () => {
  it("keeps the error out of the DOM until revealed", () => {
    const hidden = renderToStaticMarkup(<RevealableError text={QUOTE} />);
    expect(hidden).toContain("data-reveal-error"); // the tap target is there
    expect(hidden).toContain('data-revealed="false"');
    expect(hidden).not.toContain(QUOTE); // genuinely absent, not merely masked
  });

  it("shows the error once, marked, when revealed", () => {
    const shown = renderToStaticMarkup(<RevealableError text={QUOTE} defaultRevealed />);
    expect(shown).toContain('data-revealed="true"');
    expect(shown).toContain("data-error-text");
    expect(shown).toContain(QUOTE);
    expect(shown).toMatch(/data-error-text[^>]*line-through/);
  });
});
