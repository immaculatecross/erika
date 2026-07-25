import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { createSession } from "@/lib/sessions";
import { upsertSegment } from "@/lib/segments";
import { parseDeepResponse } from "@/lib/analysis/audio-model";
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

  it("a genuinely unreadable label still fails the whole reply, exactly as before", () => {
    // This is not leniency. Accepting `register` is a coverage fix for a label WE
    // invite; an unrecognisable one is still a truthful parse error rather than a
    // silently mislabelled finding.
    const bogus = REPLY.replace('"category":"register"', '"category":"vibes"');
    expect(bogus).not.toBe(REPLY); // the mutation really landed
    expect(() => parseDeepResponse(bogus)).toThrow();
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
