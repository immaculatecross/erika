import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DrillCard } from "@/components/drill-card";
import type { ItemExercise } from "@/lib/lessons/item-lessons-view";

// A render-level test that REACHES THE RUNNER'S DRILL. The E-45 Full review found
// two defects here and neither was reachable by any test — a grep over tests/ and
// e2e/ for the runner returned nothing, so the whole voice path was verified only
// by reading. `renderToStaticMarkup` is the node harness the other render tests use
// (effects that need `window` do not run, so initial state renders).
//
// What this pins is the shape of the answer surface, which is what both defects
// were about: there is no field to type into, a spoken drill still offers its
// options, and the dispute copy is present.

const SPOKEN: ItemExercise = {
  type: "choice",
  prompt: "Ieri ____ andato al mare.",
  options: ["sono", "ho"],
  answerIndex: 0,
  answer: "sono",
  invite: "speak",
  rationale: "andare takes essere.",
};

const CLICKED: ItemExercise = { ...SPOKEN, invite: "click" };

describe("the drill surface — click or voice, never typing", () => {
  it("renders NO text input on a spoken drill", () => {
    const html = renderToStaticMarkup(<DrillCard exercise={SPOKEN} speechOffered onResolve={() => {}} />);
    // Typing left the daily flow with `fill_in`, `rewrite` and the typed `cloze`.
    // If an input ever comes back, this is the test that says so.
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Type your answer");
  });

  it("renders NO text input on a clicked drill either", () => {
    const html = renderToStaticMarkup(<DrillCard exercise={CLICKED} speechOffered onResolve={() => {}} />);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<textarea");
  });

  it("offers the microphone AND every option on a spoken drill — voice is never the only way", () => {
    const html = renderToStaticMarkup(<DrillCard exercise={SPOKEN} speechOffered onResolve={() => {}} />);
    expect(html).toContain("data-drill-speak");
    // The click fallback is what keeps voice from ever being a dead end.
    for (const option of SPOKEN.options) expect(html).toContain(option);
    expect(html).toContain("Say the answer, or tap one below.");
  });

  it("withdraws the microphone once the session has fallen back, and keeps the options", () => {
    // `speechOffered={false}` is what the runner passes after three consecutive
    // disputes. The drill must still be fully answerable.
    const html = renderToStaticMarkup(<DrillCard exercise={SPOKEN} speechOffered={false} onResolve={() => {}} />);
    expect(html).not.toContain("data-drill-speak");
    for (const option of SPOKEN.options) expect(html).toContain(option);
  });

  it("never offers the microphone on a drill that did not invite it", () => {
    const html = renderToStaticMarkup(<DrillCard exercise={CLICKED} speechOffered onResolve={() => {}} />);
    expect(html).not.toContain("data-drill-speak");
  });

  it("shows no verdict, no transcript and no dispute control before an answer", () => {
    const html = renderToStaticMarkup(<DrillCard exercise={SPOKEN} speechOffered onResolve={() => {}} />);
    expect(html).not.toContain("data-feedback");
    expect(html).not.toContain("data-heard");
    expect(html).not.toContain("data-not-what-i-said");
    // …and the answer is not sitting in the markup as a data attribute.
    expect(html).not.toContain('data-correct="true"');
  });
});
