import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { writeSettings } from "@/lib/settings";
import { registerInstruction } from "@/lib/register";
import { MISTAKE_CLASS_LINES, PRECISION_CORE_LINES } from "@/lib/mistakes";
import { buildTutorSessionConfig } from "@/lib/tutor/session-config";
import { buildMintSessionWireBody } from "@/lib/tutor/mint";

// THE GUARDRAILS, IN THE INSTRUCTIONS THE MODEL ACTUALLY RECEIVES (E-43 criterion 3).
//
// `tests/tutor-persona.test.ts` asserts each guardrail against `buildTutorPersona`'s
// output, which is the right place for the WORDING. This file closes a different gap:
// the persona reaches OpenAI through the mint's explicit field allowlist, and if
// `instructions` were ever dropped from that allowlist every persona test would stay
// green while the model received no guardrail at all. So the assertions here start
// from the wire body — the last thing before the network.

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-wire-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function wireInstructions(db: Db): string {
  const { config } = buildTutorSessionConfig(db);
  const wire = buildMintSessionWireBody(config) as unknown as { instructions?: string };
  return wire.instructions ?? "";
}

describe("every precision guardrail reaches the wire", () => {
  it("carries all three PRECISION_CORE_LINES verbatim", () => {
    const db = freshDb();
    const sent = wireInstructions(db);
    // The expectation is the SHARED definition, not a copy pasted into this file: a
    // test that restates the wording could never notice the wording changing.
    for (const line of PRECISION_CORE_LINES) expect(sent).toContain(line);
    db.close();
  });

  it("carries every mistake class the shared definition names", () => {
    const db = freshDb();
    const sent = wireInstructions(db);
    for (const line of MISTAKE_CLASS_LINES) expect(sent).toContain(line);
    db.close();
  });

  it("names each guardrail the milestone is required to preserve", () => {
    const db = freshDb();
    const sent = wireInstructions(db);
    const required = [
      "Never invent an error", // never invent
      "If you did not clearly hear it, do not flag it", // audibility
      "regional or otherwise acceptable variant", // acceptable variants
      "must never infer it from their voice", // the learner's gender
      "never infer an error from what speakers of the learner's native language", // the L1
      "Correct at most one error per learner turn", // the per-turn cap
      "Do not re-drill an error you have already corrected", // no re-drilling
      "Do not invent ids", // the log_evidence id contract
    ];
    for (const clause of required) expect(sent).toContain(clause);
    db.close();
  });

  it("puts the D-23 register line FIRST, before anything about mistakes", () => {
    const db = freshDb();
    writeSettings(db, { register: "colto" });
    const sent = wireInstructions(db);
    const register = sent.indexOf(registerInstruction("colto"));
    expect(register).toBeGreaterThanOrEqual(0);
    expect(register).toBeLessThan(sent.indexOf(MISTAKE_CLASS_LINES[0]));
    db.close();
  });

  it("tells the model this is SPOKEN, and to keep every turn short", () => {
    // The spoken-output block survives the return to audio-out. The brevity clause is
    // the one dial that improves both halves of what the operator asked for: audio
    // output bills at $64/1M and is the largest leg of a conversation, and a shorter
    // reply hands the turn back sooner. Measured motivation: a 19.45-second reply to a
    // 5-second learner turn on the shipping configuration.
    const db = freshDb();
    const sent = wireInstructions(db);
    expect(sent).toContain("This is a spoken conversation");
    expect(sent).toContain("no markdown");
    expect(sent).toContain("Keep every turn SHORT");
    // …and brevity must never cost a correction. The opposite failure, asserted.
    expect(sent).toContain("Brevity is never a reason to skip a correction");
    db.close();
  });

  it("forbids narrating the tool call — found by driving the LIVE tutor", () => {
    // Two live browser runs had Erika say her own bookkeeping out loud: "un momento,
    // registro un dettaglio su ciò che hai detto" and "mi concentro su una correzione
    // chiave e poi continuiamo". The learner heard the machinery instead of a
    // conversation, and it cost a whole spoken sentence of latency. Nothing in the
    // persona forbade it, and no test could have: the text was perfectly good text.
    const db = freshDb();
    const sent = wireInstructions(db);
    expect(sent).toContain("Never mention or narrate your own tools");
    expect(sent).toContain("never announce what you are about to do");
    expect(sent).toContain("recording, noting or focusing");
    expect(sent).toMatch(/log_evidence` is silent and invisible to the learner/);
    db.close();
  });

  it("does NOT re-implement the register dial as voice styling", () => {
    // Amendment 2: both voices the operator chose were the PLAIN samples, and D-23
    // governs WHAT the tutor says through the language model, where register has
    // always belonged. Under audio-out `audio.output` exists again — it carries the
    // learner's chosen voice — so the assertion is no longer "no output block" but
    // "nothing in it but the voice". A `speed` or an instruction string appearing here
    // would be the register dial quietly becoming prosody.
    const db = freshDb();
    const { config } = buildTutorSessionConfig(db);
    const wire = buildMintSessionWireBody(config) as unknown as Record<string, unknown>;
    expect(JSON.stringify(wire)).not.toContain("instructions_audio");
    const output = (wire.audio as { output: Record<string, unknown> }).output;
    expect(Object.keys(output)).toEqual(["voice"]);
    db.close();
  });
});
