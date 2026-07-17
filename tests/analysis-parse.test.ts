import { describe, expect, it } from "vitest";
import {
  parseTriageResponse,
  parseDeepResponse,
  triagePrompt,
  deepPrompt,
  ModelParseError,
} from "@/lib/analysis/audio-model";

// Criterion 2 (parsing half) — a good model response parses into validated
// findings; a malformed or partial one is rejected with a truthful error and
// yields nothing to persist. Criterion 3 — the deep prompt carries the
// dominant-speaker instruction.

const GOOD_DEEP = JSON.stringify({
  findings: [
    {
      quote: "I have 25 years",
      correction: "I am 25 years old",
      category: "grammar",
      explanation: "Age uses 'to be', not 'to have', in English.",
      severity: "high",
      relStartMs: 500,
      relEndMs: 1500,
    },
  ],
});

describe("triage parsing", () => {
  it("reads a boolean flag and optional reason", () => {
    expect(parseTriageResponse('{"flagged":true,"reason":"hesitation"}')).toEqual({
      flagged: true,
      reason: "hesitation",
    });
    expect(parseTriageResponse('{"flagged":false}')).toEqual({ flagged: false, reason: undefined });
  });

  it("rejects a missing or non-boolean flag truthfully", () => {
    expect(() => parseTriageResponse("{}")).toThrow(ModelParseError);
    expect(() => parseTriageResponse('{"flagged":"yes"}')).toThrow(ModelParseError);
    expect(() => parseTriageResponse("not json")).toThrow(ModelParseError);
  });
});

describe("deep parsing", () => {
  it("parses a well-formed response into validated findings", () => {
    const { findings } = parseDeepResponse(GOOD_DEEP);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      quote: "I have 25 years",
      correction: "I am 25 years old",
      category: "grammar",
      severity: "high",
      relStartMs: 500,
      relEndMs: 1500,
    });
  });

  it("accepts an empty findings array (all-clear)", () => {
    expect(parseDeepResponse('{"findings":[]}').findings).toEqual([]);
  });

  it("rejects the whole response if any finding is malformed or partial", () => {
    const badCategory = JSON.stringify({ findings: [{ ...JSON.parse(GOOD_DEEP).findings[0], category: "spelling" }] });
    const badSeverity = JSON.stringify({ findings: [{ ...JSON.parse(GOOD_DEEP).findings[0], severity: "critical" }] });
    const missingQuote = JSON.stringify({ findings: [{ ...JSON.parse(GOOD_DEEP).findings[0], quote: "" }] });
    const notArray = '{"findings":{}}';
    for (const raw of [badCategory, badSeverity, missingQuote, notArray]) {
      expect(() => parseDeepResponse(raw)).toThrow(ModelParseError);
    }
  });
});

describe("prompts (criterion 3 — dominant speaker)", () => {
  it("the deep and triage prompts instruct focus on the dominant speaker", () => {
    expect(deepPrompt("Italian")).toMatch(/dominant\/primary speaker/i);
    expect(deepPrompt("Italian")).toMatch(/bystander/i);
    expect(triagePrompt("Italian")).toMatch(/dominant\/primary speaker/i);
  });
});
