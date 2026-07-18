import { describe, expect, it } from "vitest";
import {
  buildEntries,
  filterEntries,
  groupBySession,
  type ArchiveEntry,
  type ArchiveSource,
} from "@/lib/archive";

// The Speech archive's pure core (E-11 criteria 1–3): chronological timeline build
// (session date newest-first, then startMs within a session), session grouping, and
// the search × category × severity intersection. No DB, no model — plain functions.

let seq = 0;
function source(over: Partial<ArchiveSource> = {}): ArchiveSource {
  const id = `f${seq++}`;
  return {
    id,
    sessionId: "s1",
    sessionCreatedAt: "2026-07-10 09:00:00",
    sessionFilename: "s1.wav",
    quote: "he go to work",
    correction: "he goes to work",
    explanation: "Third-person singular takes -s.",
    category: "grammar",
    severity: "high",
    startMs: 1000,
    ...over,
  };
}

const entry = (over: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  ...buildEntries([source()])[0],
  ...over,
});

describe("buildEntries — chronological timeline", () => {
  it("orders by session date newest-first, then startMs ascending within a session", () => {
    // Session A is older; session B is newer. A carries two moments out of order.
    const older = { sessionId: "A", sessionCreatedAt: "2026-07-10 09:00:00", sessionFilename: "a.wav" };
    const newer = { sessionId: "B", sessionCreatedAt: "2026-07-12 09:00:00", sessionFilename: "b.wav" };
    const built = buildEntries([
      source({ id: "a-late", ...older, startMs: 3000 }),
      source({ id: "a-early", ...older, startMs: 1000 }),
      source({ id: "b-mid", ...newer, startMs: 2000 }),
    ]);
    // Newest session first (B), then session A in spoken order (1000 before 3000).
    expect(built.map((e) => e.findingId)).toEqual(["b-mid", "a-early", "a-late"]);
  });

  it("breaks ties deterministically by findingId at the same session and timestamp", () => {
    const same = { sessionId: "S", sessionCreatedAt: "2026-07-10 09:00:00", startMs: 500 };
    const built = buildEntries([source({ id: "z", ...same }), source({ id: "a", ...same })]);
    expect(built.map((e) => e.findingId)).toEqual(["a", "z"]);
  });

  it("carries both sides, the session date and the jump target onto each entry", () => {
    const [e] = buildEntries([source({ id: "x", quote: "I have 20 years", correction: "I am 20", startMs: 4200 })]);
    expect(e.findingId).toBe("x");
    expect(e.quote).toBe("I have 20 years");
    expect(e.correction).toBe("I am 20");
    expect(e.startMs).toBe(4200);
    expect(e.sessionCreatedAt).toBe("2026-07-10 09:00:00");
  });
});

describe("groupBySession — legible groups, order preserved", () => {
  it("collects each session's contiguous run into one group, newest session first", () => {
    const built = buildEntries([
      source({ id: "a1", sessionId: "A", sessionCreatedAt: "2026-07-10 09:00:00", startMs: 1000 }),
      source({ id: "a2", sessionId: "A", sessionCreatedAt: "2026-07-10 09:00:00", startMs: 2000 }),
      source({ id: "b1", sessionId: "B", sessionCreatedAt: "2026-07-12 09:00:00", startMs: 500 }),
    ]);
    const groups = groupBySession(built);
    expect(groups.map((g) => g.sessionId)).toEqual(["B", "A"]);
    expect(groups[0].entries.map((e) => e.findingId)).toEqual(["b1"]);
    expect(groups[1].entries.map((e) => e.findingId)).toEqual(["a1", "a2"]);
  });

  it("is empty for no entries", () => {
    expect(groupBySession([])).toEqual([]);
  });
});

describe("filterEntries — search × category × severity intersection", () => {
  const entries = [
    entry({ findingId: "g", quote: "he go to work", correction: "he goes to work", explanation: "verb agreement", category: "grammar", severity: "high" }),
    entry({ findingId: "v", quote: "make a photo", correction: "take a photo", explanation: "collocation", category: "vocabulary", severity: "medium" }),
    entry({ findingId: "i", quote: "it rains cats", correction: "it's pouring", explanation: "idiomatic weather", category: "idiom", severity: "low" }),
  ];
  const only = (f: Parameters<typeof filterEntries>[1]) => filterEntries(entries, f).map((e) => e.findingId);

  it("returns everything for a blank query and no constraints", () => {
    expect(only({ query: "", category: "all", severity: "all" })).toEqual(["g", "v", "i"]);
    expect(only({ query: "   ", category: "all", severity: "all" })).toHaveLength(3);
  });

  it("matches the query case-insensitively across quote, correction and explanation", () => {
    expect(only({ query: "PHOTO", category: "all", severity: "all" })).toEqual(["v"]); // quote
    expect(only({ query: "pouring", category: "all", severity: "all" })).toEqual(["i"]); // correction
    expect(only({ query: "AGREEMENT", category: "all", severity: "all" })).toEqual(["g"]); // explanation
  });

  it("filters by category alone and by severity alone", () => {
    expect(only({ query: "", category: "vocabulary", severity: "all" })).toEqual(["v"]);
    expect(only({ query: "", category: "all", severity: "low" })).toEqual(["i"]);
  });

  it("intersects category AND severity AND query", () => {
    expect(only({ query: "", category: "grammar", severity: "high" })).toEqual(["g"]);
    expect(only({ query: "", category: "grammar", severity: "low" })).toHaveLength(0); // no such row
    expect(only({ query: "work", category: "grammar", severity: "high" })).toEqual(["g"]);
    expect(only({ query: "work", category: "vocabulary", severity: "all" })).toHaveLength(0);
  });

  it("returns nothing for a query that matches no entry", () => {
    expect(only({ query: "zzz-nomatch", category: "all", severity: "all" })).toHaveLength(0);
  });
});
