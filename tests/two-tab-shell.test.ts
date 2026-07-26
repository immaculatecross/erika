import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { activeTab, libraryDestinations, LIBRARY, LIBRARY_SECTIONS } from "@/lib/nav";

// The shell's routing contract (E-30, extended at E-44 per D-26). Three things must
// hold and are proven here without a browser:
//   1. Route → tab mapping: every current path is owned by the right tab, or is a
//      chrome leaf (Settings, Library) owned by neither — the map the tab bar reads.
//   2. The deep-link contract: NO existing path may 404. No page moved when the
//      section sub-nav was replaced by one Library entry; the two convenience aliases
//      (/record, /learn) are still the only redirects.
//   3. The Library holds everything the demoted surfaces used to reach directly, and
//      every one of its destinations resolves to a real route in `app/`. This is the
//      E-44 half: "nothing is deleted and every existing deep link still resolves".

// Every route the app has, and the tab that must own it. `/settings` and `/library`
// are chrome leaves (null). This is the route→tab matrix reproduced in the PR.
const ROUTE_TAB: [string, "record" | "learn" | null][] = [
  ["/", "record"],
  ["/sessions/abc-123", "record"],
  ["/archive", "record"],
  ["/phrasebook", "record"],
  ["/slips", "record"],
  ["/slips/some-slip-key", "record"],
  ["/practice", "learn"],
  ["/practice/session", "learn"],
  ["/practice/cards", "learn"],
  ["/practice/review", "learn"],
  ["/practice/lessons", "learn"],
  ["/practice/lessons/category:grammar", "learn"],
  ["/practice/learn/studio", "learn"],
  ["/practice/tutor", "learn"],
  ["/focus", "learn"],
  ["/letter", "learn"],
  ["/settings", null],
  ["/library", null],
];

describe("activeTab — the route→tab matrix", () => {
  for (const [path, tab] of ROUTE_TAB) {
    it(`${path} → ${tab ?? "chrome (no tab)"}`, () => {
      expect(activeTab(path)).toBe(tab);
    });
  }

  it("an unknown path claims no tab rather than guessing", () => {
    expect(activeTab("/nope")).toBeNull();
  });

  it("a demoted surface keeps its tab, so a bookmark still lands somewhere honest", () => {
    // Focus and the letter moved BEHIND the Library entry, not out of Learn — a deep
    // link into either must still light the Learn tab rather than nothing.
    expect(activeTab("/focus")).toBe("learn");
    expect(activeTab("/letter")).toBe("learn");
  });
});

describe("the one Library entry (E-44 criterion 6)", () => {
  it("holds every surface demoted off the Learn home, and nothing is missing", () => {
    const hrefs = libraryDestinations().map((d) => d.href);
    for (const required of [
      "/focus",
      "/letter",
      "/phrasebook",
      "/archive",
      "/slips",
      "/practice/cards",
      // [E-45] "/practice/lessons" is NOT here: the per-category pattern-lesson
      // browser is deleted with the format it listed. Demote-never-delete still
      // holds for every surface that still exists — this one does not, so leaving
      // it in the Library would be a link to a 404, which is the wall E-44's own
      // criterion forbids.
      "/practice/learn/studio",
      "/practice/learn/shadow",
      "/practice/reading",
    ]) {
      expect(hrefs).toContain(required);
    }
  });

  it("lists each destination exactly once — one entry, not a second navigation", () => {
    const hrefs = libraryDestinations().map((d) => d.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every destination states what is behind it", () => {
    for (const dest of libraryDestinations()) {
      expect(dest.note.length).toBeGreaterThan(10);
      expect(dest.label.length).toBeGreaterThan(0);
    }
  });

  it("every Library href resolves to a real page in app/", () => {
    // The E-37 lesson, mechanised: a link is not a route. Each href must correspond to
    // a `page.tsx` on disk, so a demoted surface cannot be quietly delisted into a 404.
    const root = path.join(process.cwd(), "app");
    for (const dest of [...libraryDestinations(), LIBRARY]) {
      const page = path.join(root, dest.href.replace(/^\//, ""), "page.tsx");
      expect(fs.existsSync(page), `${dest.href} → ${page}`).toBe(true);
    }
  });
});

describe("deep-link contract — no path 404s", () => {
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
    for (const [route] of ROUTE_TAB) {
      if (!aliases.has(route)) expect(map.has(route)).toBe(false);
    }
    // And no Library destination was turned into a redirect either.
    for (const dest of libraryDestinations()) expect(map.has(dest.href)).toBe(false);
  });
});

describe("the Library is grouped, not a heap", () => {
  it("groups every destination under a titled section", () => {
    expect(LIBRARY_SECTIONS.length).toBeGreaterThan(1);
    for (const section of LIBRARY_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.items.length).toBeGreaterThan(0);
    }
  });
});
