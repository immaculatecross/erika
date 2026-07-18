import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/analysis/findings";
import {
  buildEntries,
  filterEntries,
  toEntry,
  type PhrasebookEntry,
} from "@/lib/phrasebook";

// The Phrasebook's pure core (E-9 criteria 1–2): building library entries from
// findings and the search/filter — query × category intersection, case-insensitive,
// blank-query-returns-all, no-match. No DB, no model — plain functions over rows.

let seq = 0;
function finding(over: Partial<Finding> = {}): Finding {
  const id = `f${seq++}`;
  return {
    id,
    sessionId: "s1",
    contentHash: `h-${id}`,
    quote: "he go to work",
    correction: "he goes to work",
    category: "grammar",
    explanation: "Third-person singular takes -s.",
    severity: "high",
    startMs: 1000,
    endMs: 2000,
    ...over,
  };
}

function entry(over: Partial<PhrasebookEntry> = {}): PhrasebookEntry {
  return { ...toEntry(finding(), false), ...over };
}

describe("toEntry / buildEntries", () => {
  it("carries both sides and marks in-deck from the finding-id set", () => {
    const e = toEntry(finding({ id: "x", quote: "I have 20 years", correction: "I am 20 years old" }), true);
    expect(e.findingId).toBe("x");
    expect(e.quote).toBe("I have 20 years"); // what you said
    expect(e.correction).toBe("I am 20 years old"); // the native recast
    expect(e.inDeck).toBe(true);
  });

  it("builds one entry per finding, in-deck iff its id is in the set", () => {
    const findings = [finding({ id: "a" }), finding({ id: "b" }), finding({ id: "c" })];
    const entries = buildEntries(findings, new Set(["b"]));
    expect(entries.map((e) => e.findingId)).toEqual(["a", "b", "c"]);
    expect(entries.map((e) => e.inDeck)).toEqual([false, true, false]);
  });
});

describe("filterEntries", () => {
  const entries = [
    entry({ findingId: "g", quote: "he go to work", correction: "he goes to work", explanation: "verb agreement", category: "grammar" }),
    entry({ findingId: "v", quote: "make a photo", correction: "take a photo", explanation: "collocation", category: "vocabulary" }),
    entry({ findingId: "i", quote: "it rains cats", correction: "it's pouring", explanation: "idiomatic weather", category: "idiom" }),
  ];

  it("returns everything for a blank query and category 'all'", () => {
    expect(filterEntries(entries, { query: "", category: "all" })).toHaveLength(3);
    expect(filterEntries(entries, { query: "   ", category: "all" })).toHaveLength(3);
  });

  it("matches the query case-insensitively across quote, correction and explanation", () => {
    // quote hit
    expect(filterEntries(entries, { query: "PHOTO", category: "all" }).map((e) => e.findingId)).toEqual(["v"]);
    // correction hit
    expect(filterEntries(entries, { query: "pouring", category: "all" }).map((e) => e.findingId)).toEqual(["i"]);
    // explanation hit
    expect(filterEntries(entries, { query: "AGREEMENT", category: "all" }).map((e) => e.findingId)).toEqual(["g"]);
  });

  it("filters by category alone", () => {
    expect(filterEntries(entries, { query: "", category: "vocabulary" }).map((e) => e.findingId)).toEqual(["v"]);
  });

  it("intersects query AND category", () => {
    // "work" matches the grammar entry; under the vocabulary category that is empty.
    expect(filterEntries(entries, { query: "work", category: "grammar" }).map((e) => e.findingId)).toEqual(["g"]);
    expect(filterEntries(entries, { query: "work", category: "vocabulary" })).toHaveLength(0);
  });

  it("returns nothing for a query that matches no entry", () => {
    expect(filterEntries(entries, { query: "zzz-nomatch", category: "all" })).toHaveLength(0);
  });
});
