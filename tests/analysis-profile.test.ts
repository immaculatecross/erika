import { describe, expect, it } from "vitest";
import {
  buildSpeakerProfile,
  l1Line,
  profileBlock,
  PROFILE_MAX_CHARS,
  PROFILE_MAX_ENTRIES,
  renderProfileLines,
  resolveRecurrence,
  type ProfileInput,
  type SpeakerProfile,
} from "@/lib/analysis/profile";
import { computeFocus } from "@/lib/focus";
import { deepPrompt, parseDeepResponse, RECURRENCE_INSTRUCTION, triagePrompt } from "@/lib/analysis/audio-model";
import { lessonPrompt } from "@/lib/lessons/generate";
import type { Category, Finding, Severity } from "@/lib/analysis/findings";
import type { Pattern } from "@/lib/lessons/patterns";

// E-19 criteria 1–2: the pure profile builder (bounded, no model call, no
// reimplemented math — rates come straight from computeFocus) and the exact
// L1/profile injection into all three prompts. Plus the D-13-defensive optional
// recurrence field on the deep-reply parser (criterion 3's pure half).

function f(quote: string, correction: string, category: Category = "grammar", severity: Severity = "medium") {
  return { quote, correction, category, severity };
}

/** A ready profile: "ho 25 anni" corrected twice (high) beats a 2x low pair. */
function primedInput(): ProfileInput {
  const findings = [
    f("io ho 25 anni", "ho 25 anni — but say: compio 25 anni", "grammar", "high"),
    f("ho venticinque anno", "ho 25 anni — but say: compio 25 anni", "grammar", "high"),
    f("il problema è che...", "il punto è che...", "phrasing", "low"),
    f("il problema era che...", "il punto è che...", "phrasing", "low"),
    f("una tantum", "una volta sola", "vocabulary", "medium"),
  ];
  return {
    nativeLanguage: "English",
    findings,
    focus: computeFocus([
      {
        id: "s1",
        createdAt: "2026-07-01 10:00:00",
        speechMs: 1_800_000, // half an hour
        findings: findings.map(({ category, severity }) => ({ category, severity })),
      },
    ]),
    mastery: [
      { category: "grammar", mastery: 0.75 },
      { category: "idiom", mastery: 0 },
    ],
  };
}

const emptyInput = (): ProfileInput => ({
  nativeLanguage: "English",
  findings: [],
  focus: computeFocus([]),
  mastery: [],
});

describe("buildSpeakerProfile (criterion 1)", () => {
  it("dedups by correction, ranks by severity weight, and labels entries R1…", () => {
    const p = buildSpeakerProfile(primedInput());
    // "una tantum" occurred once — never an entry. The 2x high pair outranks the 2x low pair.
    expect(p.entries.map((e) => e.id)).toEqual(["R1", "R2"]);
    expect(p.entries[0]).toMatchObject({
      correction: "ho 25 anni — but say: compio 25 anni",
      category: "grammar",
      count: 2,
    });
    expect(p.entries[0].quote).toBe("io ho 25 anni"); // newest-first representative
    expect(p.entries[1]).toMatchObject({ correction: "il punto è che...", count: 2 });
  });

  it("takes rates from computeFocus, not its own math, and only non-zero ones", () => {
    const p = buildSpeakerProfile(primedInput());
    const grammar = p.rates.find((r) => r.category === "grammar")!;
    // 2 grammar findings in 0.5 analysed hours = 4/hour — computeFocus's number.
    expect(grammar).toEqual({ category: "grammar", count: 2, ratePerHour: 4 });
    expect(p.rates.map((r) => r.category).sort()).toEqual(["grammar", "phrasing", "vocabulary"]);
  });

  it("keeps only non-zero mastery", () => {
    expect(buildSpeakerProfile(primedInput()).mastery).toEqual([{ category: "grammar", mastery: 0.75 }]);
  });

  it("caps entries at PROFILE_MAX_ENTRIES", () => {
    const findings = Array.from({ length: 20 }, (_, i) => [
      f(`quote ${i}`, `correction ${i}`),
      f(`quote ${i} again`, `correction ${i}`),
    ]).flat();
    const p = buildSpeakerProfile({ ...emptyInput(), findings });
    expect(p.entries).toHaveLength(PROFILE_MAX_ENTRIES);
  });

  it("a fresh user yields a well-formed minimal profile", () => {
    const p = buildSpeakerProfile(emptyInput());
    expect(p).toEqual({ nativeLanguage: "English", entries: [], rates: [], mastery: [] });
  });
});

describe("renderProfileLines is hard-bounded (criterion 1)", () => {
  it("never exceeds PROFILE_MAX_CHARS, whatever the corpus", () => {
    const long = "x".repeat(500);
    const findings = Array.from({ length: 200 }, (_, i) => [
      f(`${long} ${i}`, `${long} fix ${i}`, "grammar", "high"),
      f(`${long} ${i} bis`, `${long} fix ${i}`, "grammar", "high"),
    ]).flat();
    const p = buildSpeakerProfile({ ...emptyInput(), findings });
    expect(profileBlock(p).length).toBeLessThanOrEqual(PROFILE_MAX_CHARS);
    // Clipped fields, not clipped meaning: each entry line stays bounded too.
    for (const e of p.entries) {
      expect(e.quote.length).toBeLessThanOrEqual(60);
      expect(e.correction.length).toBeLessThanOrEqual(60);
    }
  });

  it("a fresh user renders exactly the L1 line — no empty scaffolding", () => {
    expect(renderProfileLines(buildSpeakerProfile(emptyInput()))).toEqual([l1Line("English")]);
  });
});

describe("prompt injection (criterion 2)", () => {
  const profile = buildSpeakerProfile(primedInput());
  const lines = renderProfileLines(profile);
  const pattern: Pattern = {
    key: "category:grammar",
    category: "grammar",
    count: 3,
    findings: [
      {
        id: "f1",
        sessionId: "s",
        contentHash: "h",
        quote: "io ho 25 anni",
        correction: "ho 25 anni",
        category: "grammar",
        explanation: "why",
        severity: "high",
        startMs: 0,
        endMs: 0,
      },
    ] as Finding[],
  };

  it("triage, deep-listen, and lesson prompts all carry the exact L1 and profile lines", () => {
    for (const prompt of [
      triagePrompt("Italian", profile),
      deepPrompt("Italian", profile),
      lessonPrompt("Italian", pattern, profile),
    ]) {
      expect(prompt).toContain(l1Line("English"));
      for (const line of lines) expect(prompt).toContain(line);
      expect(prompt).toContain('R1. said "io ho 25 anni" → "ho 25 anni — but say: compio 25 anni" (grammar, seen 2x)');
    }
  });

  it("the deep prompt asks for recurrenceId only when there are entries to cite", () => {
    expect(deepPrompt("Italian", profile)).toContain(RECURRENCE_INSTRUCTION);
    expect(deepPrompt("Italian", buildSpeakerProfile(emptyInput()))).not.toContain(RECURRENCE_INSTRUCTION);
  });

  it("a fresh user's prompts stay valid — the L1 line, no undefined, no scaffolding", () => {
    const fresh = buildSpeakerProfile(emptyInput());
    for (const prompt of [
      triagePrompt("Italian", fresh),
      deepPrompt("Italian", fresh),
      lessonPrompt("Italian", pattern, fresh),
    ]) {
      expect(prompt).toContain(l1Line("English"));
      expect(prompt).not.toContain("undefined");
      expect(prompt).not.toContain("Known recurring errors");
      expect(prompt).toMatch(/JSON/i); // still a well-formed instruction prompt
    }
  });

  it("a profile-less call builds the exact pre-E-19 prompts", () => {
    expect(triagePrompt("Italian")).not.toContain("native language");
    expect(deepPrompt("Italian")).not.toContain(RECURRENCE_INSTRUCTION);
  });
});

describe("optional recurrence on the deep reply (criterion 3, parser half)", () => {
  const finding = (extra: Record<string, unknown>) => ({
    quote: "q",
    correction: "c",
    category: "grammar",
    explanation: "e",
    severity: "low",
    ...extra,
  });

  it("a valid recurrenceId is carried through", () => {
    const res = parseDeepResponse(JSON.stringify({ findings: [finding({ recurrenceId: " R1 " })] }));
    expect(res.findings[0].recurrenceId).toBe("R1");
  });

  it("a reply without it parses exactly as today", () => {
    const res = parseDeepResponse(JSON.stringify({ findings: [finding({})] }));
    expect(res.findings[0].recurrenceId).toBeUndefined();
  });

  it("garbage recurrence values never fail the finding", () => {
    for (const junk of [42, "", "   ", null, { id: "R1" }, ["R1"], true]) {
      const res = parseDeepResponse(JSON.stringify({ findings: [finding({ recurrenceId: junk })] }));
      expect(res.findings[0].quote).toBe("q"); // parsed fine
      expect(res.findings[0].recurrenceId).toBeUndefined();
    }
  });
});

describe("resolveRecurrence (criterion 3, resolution half)", () => {
  const profile: SpeakerProfile = {
    nativeLanguage: "English",
    entries: [{ id: "R1", quote: "q", correction: "the fix", category: "grammar", count: 2 }],
    rates: [],
    mastery: [],
  };

  it("resolves a known id to the entry's correction", () => {
    expect(resolveRecurrence(profile, "R1")).toBe("the fix");
  });

  it("is null for unknown ids, missing ids, and missing profiles (D-13)", () => {
    expect(resolveRecurrence(profile, "R99")).toBeNull();
    expect(resolveRecurrence(profile, undefined)).toBeNull();
    expect(resolveRecurrence(undefined, "R1")).toBeNull();
  });
});
