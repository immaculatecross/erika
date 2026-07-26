import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettingsPage from "@/app/(app)/settings/page";
import { keyStatusLine } from "@/lib/analysis-key";
import { TRANSIENT_WORDS } from "@/lib/session/notices";

// WHAT ERIKA NEEDS, RENDERED (E-42 criterion 7 + the Full review's standing-clause finding).
//
// Two things this pins that prose alone could not:
//
//  1. The disclosure renders on the LOADING branch — before, and independently of,
//     the `/api/settings` fetch. It used to sit after `if (!form) return …`, so a new
//     user saw it only on a successful fetch and never at all if that fetch failed:
//     the single most important text on the page, gated behind a network call.
//  2. It names the SECOND PROCESS. This milestone removed every button from the
//     capture path, which makes `npm run worker` the only thing a newcomer must still
//     do by hand — and a learner who records and then watches nothing happen has been
//     asked a question the product never answered. That is exactly what made the v0.6
//     cold-start gate FAIL, so it is not a nit; it is the bar.
//
// `renderToStaticMarkup` runs the tree without a DOM: effects do not fire, so this is
// precisely the pre-fetch state a newcomer's first paint shows.

const html = renderToStaticMarkup(<SettingsPage />);

describe("the Settings disclosure survives the loading state", () => {
  it("renders before any fetch resolves", () => {
    expect(html).toContain("data-analysis-disclosure");
    expect(html).toContain("What Erika needs");
    // The proof that this IS the pre-fetch paint, not the loaded one.
    expect(html).toContain("Loading settings…");
  });

  it("states that an API key is required, and where to put it", () => {
    expect(html).toMatch(/OpenAI API key/);
    expect(html).toContain(".env.local");
    expect(html).toContain("OPENAI_API_KEY=sk");
  });

  it("states that analysis is automatic — the trade that makes removing the price tags honest", () => {
    expect(html).toMatch(/analyzed automatically when they finish uploading/i);
  });

  it("states what the cap is and what happens when it is reached", () => {
    expect(html).toMatch(/hard cap/i);
    expect(html).toMatch(/resumes on its own/i);
    expect(html).toMatch(/never have to upload anything twice/i);
  });

  it("names the second process — the one manual prerequisite this milestone leaves", () => {
    expect(html).toContain("data-worker-prerequisite");
    expect(html).toContain("npm run worker");
    expect(html).toMatch(/two processes/i);
    // And says what its absence LOOKS like, because the failure mode is silence.
    expect(html).toMatch(/looks exactly like nothing happening/i);
  });

  // [v0.7 close sweep] The gate's finding 10: the status line said "No key is set RIGHT
  // NOW, so analysis will not run" two sentences after the paragraph above it said the
  // condition "stays true until you add one" — the configuration screen contradicting
  // itself, in the softener this app's own copy rule forbids for a standing condition.
  it("states the keyless condition as STANDING, agreeing with the paragraph above it", () => {
    const keyless = keyStatusLine(false);
    for (const word of TRANSIENT_WORDS) expect(keyless.toLowerCase()).not.toContain(word);
    // It says what makes it stop being true — the same remedy the disclosure names.
    expect(keyless).toMatch(/until you add one/i);
    expect(html).toMatch(/stays true until you add one/i);
    // And a key that IS set is simply a fact, with nothing softened either.
    for (const word of TRANSIENT_WORDS) expect(keyStatusLine(true).toLowerCase()).not.toContain(word);
  });

  it("never shows a key, only whether one is set", () => {
    // The disclosure may report presence; it must never render a credential.
    expect(html).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });
});
