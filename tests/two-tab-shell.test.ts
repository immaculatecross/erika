import { describe, expect, it } from "vitest";
import {
  activeTab,
  isSectionActive,
  sectionFor,
  LEARN_SECTION,
  RECORD_SECTION,
} from "@/lib/nav";

// The two-tab shell's routing contract (E-30). Two things must hold and are
// proven here without a browser:
//   1. Route → tab mapping: every current path is owned by the right tab (or is
//      the Settings gear leaf, owned by neither) — the map the tab bar reads.
//   2. The deep-link contract: NO existing path may 404. No page moved, so every
//      path resolves in place; the two convenience aliases (/record, /learn) are
//      the only redirects, and next.config's redirects() is asserted below.

// Every route the app has today, and the tab that must own it. `/settings` is the
// gear leaf (null). This is the route→tab matrix reproduced in the PR.
const ROUTE_TAB: [string, "record" | "learn" | null][] = [
  ["/", "record"],
  ["/sessions/abc-123", "record"],
  ["/archive", "record"],
  ["/phrasebook", "record"],
  ["/slips", "record"],
  ["/slips/some-slip-key", "record"],
  ["/practice", "learn"],
  ["/practice/cards", "learn"],
  ["/practice/review", "learn"],
  ["/practice/lessons", "learn"],
  ["/practice/lessons/category:grammar", "learn"],
  ["/focus", "learn"],
  ["/letter", "learn"],
  ["/settings", null],
];

describe("activeTab — the route→tab matrix (criterion 1)", () => {
  for (const [path, tab] of ROUTE_TAB) {
    it(`${path} → ${tab ?? "gear (no tab)"}`, () => {
      expect(activeTab(path)).toBe(tab);
    });
  }

  it("an unknown path claims no tab rather than guessing", () => {
    expect(activeTab("/nope")).toBeNull();
  });
});

describe("section sub-nav — Library under Record, the course under Learn", () => {
  it("Record's section is the Library; Learn's is today/focus/letter", () => {
    expect(sectionFor("record")).toBe(RECORD_SECTION);
    expect(sectionFor("learn")).toBe(LEARN_SECTION);
    expect(sectionFor(null)).toEqual([]);
    expect(RECORD_SECTION.map((d) => d.href)).toEqual(["/", "/archive", "/phrasebook", "/slips"]);
    expect(LEARN_SECTION.map((d) => d.href)).toEqual(["/practice", "/focus", "/letter"]);
  });

  it("keeps a section item lit for its descendants but '/' only for exact root", () => {
    expect(isSectionActive("/", "/")).toBe(true);
    expect(isSectionActive("/archive", "/")).toBe(false);
    expect(isSectionActive("/slips/x", "/slips")).toBe(true);
    expect(isSectionActive("/practice/review", "/practice")).toBe(true);
  });
});

describe("deep-link contract — no path 404s (criterion 2)", () => {
  it("only /record and /learn redirect; every other route stays in place", async () => {
    type Redirect = { source: string; destination: string; permanent: boolean };
    // next.config.mjs ships no type declarations (it is plain ESM config, not part
    // of the typed source graph); we only need its runtime redirects() here.
    // @ts-expect-error untyped .mjs config module (runtime redirects only) mfactory-allow:ts-suppress
    const cfg = (await import("../next.config.mjs")).default as {
      redirects?: () => Promise<Redirect[]>;
    };
    const redirects = (await cfg.redirects?.()) ?? [];
    const map = new Map(redirects.map((r) => [r.source, r.destination]));
    expect(map.get("/record")).toBe("/");
    expect(map.get("/learn")).toBe("/practice");

    // Every path in the matrix that is NOT an alias resolves in place — it must
    // not be redirected away (that would break the bookmark/deep link).
    const aliases = new Set(["/record", "/learn"]);
    for (const [path] of ROUTE_TAB) {
      if (!aliases.has(path)) expect(map.has(path)).toBe(false);
    }
  });
});
