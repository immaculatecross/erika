import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { parseDeepResponse } from "@/lib/analysis/audio-model";
import { normalizeCategory } from "@/lib/analysis/findings";
import { persistSegmentFindings } from "@/lib/analysis/findings";
import { listSessionFindings } from "@/lib/findings-model";
import { deepPrompt } from "@/lib/analysis/prompts";
import { registerInstruction } from "@/lib/register";
import { MISTAKE_CLASS_LINES } from "@/lib/mistakes";

// THE ONE LABEL THE PROMPT INVITED AND THE PARSER REFUSED (E-42 criterion 14).
//
// `register` was instructed — `lib/mistakes.ts` class B names a register slip as a
// mistake, D-23 makes the dial a first-class idea, and ENRICHED_NOTES_INSTRUCTION
// puts the very word in front of the model as a field name — but it was not an
// accepted `category`, and the failure mode was not one lost finding: an
// off-vocabulary category makes `parseDeepResponse` reject the WHOLE reply, so the
// entire segment was recorded unreadable. A class the model is asked to produce and
// the schema silently discards is the exact defect PR #66 existed to remove.
//
// The resolution (criterion 12, stated once in lib/register.ts): a register slip is a
// WORD-CHOICE mistake. It is accepted end to end — prompt → parse → persist →
// surface — and stored as `vocabulary`, which also settles criterion 12's question
// about whether such a finding is cardable: it is, exactly like any other vocabulary
// finding, with no new category and no separate drill path.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-register-cat-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}

/** A deep reply in which the model labelled one finding "register", as invited. */
const REPLY = JSON.stringify({
  findings: [
    {
      quote: "penso che è vero",
      correction: "penso che sia vero",
      category: "grammar",
      explanation: "congiuntivo dopo penso che",
      severity: "high",
      relStartMs: 0,
      relEndMs: 100,
    },
    {
      quote: "sta roba non mi garba",
      correction: "questa faccenda non mi aggrada",
      category: "register",
      explanation: "slang where the chosen register is colto",
      severity: "medium",
      relStartMs: 100,
      relEndMs: 200,
    },
    {
      quote: "ho fatto una decisione",
      correction: "ho preso una decisione",
      category: "idiom",
      explanation: "calque",
      severity: "medium",
      relStartMs: 200,
      relEndMs: 300,
    },
  ],
  produced: [],
});

describe("1 · the prompt invites it, and says where it belongs", () => {
  it("names the register as a judgeable target and maps a slip onto a stored word", () => {
    const prompt = deepPrompt("Italian", undefined, "colto");
    // The dial's one coherent statement is composed in (criterion 12)…
    expect(prompt).toContain(registerInstruction("colto"));
    // …the shared mistake definition names register slips as real mistakes…
    expect(MISTAKE_CLASS_LINES.some((l) => /^- Register:/.test(l))).toBe(true);
    // …and the prompt tells the model, explicitly, which of the five words to use,
    // so the alias table below is a safety net rather than the only thing standing
    // between us and a lost segment.
    expect(prompt).toMatch(/label it "vocabulary", not "register"/);
  });
});

describe("2 · the parser accepts it, and the rest of the segment survives", () => {
  it("parses a reply containing `register` instead of discarding all three findings", () => {
    const parsed = parseDeepResponse(REPLY);
    expect(parsed.findings).toHaveLength(3);
    const categories = parsed.findings.map((f) => f.category).sort();
    expect(categories).toEqual(["grammar", "idiom", "vocabulary"]);
    // Specifically: the register finding kept its own content, it was not dropped and
    // it did not overwrite anything.
    const slip = parsed.findings.find((f) => f.quote === "sta roba non mi garba")!;
    expect(slip.category).toBe("vocabulary");
    expect(slip.correction).toBe("questa faccenda non mi aggrada");
  });

  it("a genuinely unreadable label costs its own finding and nothing else", () => {
    // This is not leniency about the LABEL — an unrecognisable value is still never
    // guessed at, and that finding is still dropped rather than mislabelled. What
    // changed (spike-6) is the BLAST RADIUS: this used to reject the whole reply, so
    // one unreadable word destroyed every other mistake the model had heard in the
    // same segment. See the "2b" block below for the invariant and its opposite.
    const bogus = REPLY.replace('"category":"register"', '"category":"vibes"');
    expect(bogus).not.toBe(REPLY); // the mutation really landed
    const parsed = parseDeepResponse(bogus);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings.map((f) => f.category).sort()).toEqual(["grammar", "idiom"]);
    expect(parsed.findings.some((f) => f.quote === "sta roba non mi garba")).toBe(false);
  });
});

describe("2b · A BAD FINDING COSTS ITSELF, NEVER THE SEGMENT [spike-6, live]", () => {
  // THE INVARIANT: a model reply that names a class we asked for must never cost us
  // the rest of the segment.
  //
  // Measured against the real API over ~130 calls, `gpt-audio-1.5` answered
  // `"vocabulary and word choice"` on 3 of 27 findings — the *heading* of class B in
  // `lib/mistakes.ts`, composed into the very prompt that asks the question. The
  // parser refused it and threw away every other finding in those segments, then
  // recorded them unreadable so a later run re-billed the deep call to lose them
  // again. The core promise failing silently, on the path E-42 makes automatic.

  /** The exact string the live model returned. */
  const LIVE = "vocabulary and word choice";

  it("resolves the label the live model actually returned", () => {
    expect(normalizeCategory(LIVE)).toBe("vocabulary");
    // …and its plausible neighbours, because enumerating one string fixes one string.
    for (const v of [
      "VOCABULARY AND WORD CHOICE",
      "vocabulary / word choice",
      "vocabulary_and_word_choice",
      "word-choice error",
      "grammar (agreement)",
      "pronunciation — gemination",
      "idiomatic expression",
    ]) {
      expect(normalizeCategory(v)).not.toBeNull();
    }
  });

  it("still refuses a label that points at two categories at once", () => {
    // Guessing between them would mislabel a finding, and mislabelling is worse than
    // dropping. The ambiguity rule is the point of the containment fallback.
    expect(normalizeCategory("grammar and vocabulary")).toBeNull();
    expect(normalizeCategory("vibes")).toBeNull();
    expect(normalizeCategory("")).toBeNull();
  });

  it("keeps every OTHER finding when one has an unreadable category", () => {
    const reply = JSON.stringify({
      findings: [
        { quote: "a", correction: "b", category: "grammar", explanation: "e", severity: "high", relStartMs: 0, relEndMs: 1 },
        { quote: "c", correction: "d", category: "wat", explanation: "e", severity: "high", relStartMs: 1, relEndMs: 2 },
        { quote: "f", correction: "g", category: "idiom", explanation: "e", severity: "low", relStartMs: 2, relEndMs: 3 },
      ],
    });
    const parsed = parseDeepResponse(reply);
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.findings.map((f) => f.quote)).toEqual(["a", "f"]);
  });

  it("drops a finding for ANY per-finding fault, never the segment", () => {
    // Enumerated: not an object; blank quote / correction / explanation; unreadable
    // category; unreadable severity. Each is a fact about one finding.
    const good = { quote: "ok", correction: "fix", category: "grammar", explanation: "why", severity: "low" };
    const bad: unknown[] = [
      null,
      "not an object",
      { ...good, quote: "   " },
      { ...good, correction: "" },
      { ...good, explanation: undefined },
      { ...good, category: "vibes" },
      { ...good, severity: "catastrophic" },
    ];
    for (const b of bad) {
      const parsed = parseDeepResponse(JSON.stringify({ findings: [good, b] }));
      expect(parsed.findings).toHaveLength(1);
      expect(parsed.findings[0].quote).toBe("ok");
    }
  });

  it("STILL rejects a structurally unreadable reply — nothing can be salvaged from a shape we cannot walk", () => {
    expect(() => parseDeepResponse("not json at all")).toThrow();
    expect(() => parseDeepResponse(JSON.stringify({ findings: "nope" }))).toThrow();
    expect(() => parseDeepResponse(JSON.stringify({ produced: [] }))).toThrow();
  });

  it("THE OPPOSITE FAILURE: all findings unreadable throws rather than reporting a clean bill of health", () => {
    // Returning [] here would persist "analysed, no mistakes" over a segment the
    // model actually reported mistakes in — the E-16b criterion 5 lie in a new
    // costume. This is the guard that keeps the leniency above from becoming one.
    const allBad = JSON.stringify({
      findings: [
        { quote: "a", correction: "b", category: "vibes", explanation: "e", severity: "high" },
        { quote: "c", correction: "d", category: "nonsense", explanation: "e", severity: "high" },
      ],
    });
    expect(() => parseDeepResponse(allBad)).toThrow(/none could be read/i);
  });

  it("an ALREADY-empty findings list is a real answer and is left alone", () => {
    // "The speaker made no errors" is the commonest reply on clean speech; it must
    // not be confused with "everything was unreadable".
    const clean = parseDeepResponse(JSON.stringify({ findings: [], produced: [] }));
    expect(clean.findings).toEqual([]);
  });

  it("the prompt no longer teaches the heading as a category value", () => {
    // Both halves of the fix: the parser tolerates it, and the prompt stops inviting
    // it. Widening the parser alone would leave us relying on tolerance forever.
    expect(deepPrompt("Italian")).toMatch(/NOT the heading of the class it came from/);
  });
});

describe("3 · it persists and surfaces like any other finding", () => {
  it("stores as vocabulary and comes back through the one findings read-model", () => {
    const db = freshDb();
    createSession(db, {
      id: "s",
      originalFilename: "s.wav",
      format: "wav",
      sizeBytes: 1,
      durationSeconds: 60,
    });
    upsertSegment(db, { sessionId: "s", idx: 0, startMs: 0, endMs: 60_000, contentHash: "h0" });

    const parsed = parseDeepResponse(REPLY);
    persistSegmentFindings(db, {
      sessionId: "s",
      contentHash: "h0",
      flagged: true,
      deepDone: true,
      findings: parsed.findings.map((f) => ({
        quote: f.quote,
        correction: f.correction,
        category: f.category,
        explanation: f.explanation,
        severity: f.severity,
        startMs: f.relStartMs ?? 0,
        endMs: f.relEndMs ?? 0,
      })),
    });

    // E-17: read through the canonical model, the way every surface does — the
    // report, the Phrasebook, the Archive, card generation. If it reaches here it
    // reaches all of them.
    const surfaced = listSessionFindings(db, "s");
    expect(surfaced).toHaveLength(3);
    const slip = surfaced.find((f) => f.quote === "sta roba non mi garba")!;
    expect(slip.category).toBe("vocabulary");
    expect(slip.explanation).toContain("register");
    db.close();
  });
});
