import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "@/lib/db";
import { buildTutorPersona } from "@/lib/tutor/persona";
import { buildTutorSessionConfig, logEvidenceTool } from "@/lib/tutor/session-config";
import { registerInstruction } from "@/lib/register";
import { l1Line } from "@/lib/analysis/profile";
import { REALTIME_FLAGSHIP } from "@/lib/analysis/rates";
import { writeSettings } from "@/lib/settings";

// The tutor persona + session config (E-34, WO criterion 2). The instruction payload
// must carry the profile L1, the slip targets, today's items, and the register line;
// and the session config must ship the right model, an output voice, and the
// `log_evidence` tool. No model call is made building any of this (composition is
// model-free, E-31).

const dirs: string[] = [];
function freshDb(): Db {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-tutor-persona-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("buildTutorPersona — the instruction payload (WO criterion 2)", () => {
  it("carries the L1, the slip targets, today's items, and the register line", () => {
    const persona = buildTutorPersona({
      register: "colto",
      targetLanguage: "Italian",
      nativeLanguage: "English",
      profileLines: [l1Line("English"), 'R1. said "andato" → "andata" (grammar, seen 3x)'],
      slipTargets: ["il congiuntivo dopo penso che", "concordanza di genere"],
      todayTargets: ["casa (noun) — log as lemma:casa#NOUN", "articoli — log as rule:articoli"],
    });
    // Register line (D-23).
    expect(persona).toContain(registerInstruction("colto"));
    // Profile L1 (E-19).
    expect(persona).toContain(l1Line("English"));
    // A slip target (E-20).
    expect(persona).toContain("il congiuntivo dopo penso che");
    // Today's item (E-31), named with its exact loggable id.
    expect(persona).toContain("lemma:casa#NOUN");
    // The log_evidence tool contract (WO criterion 3).
    expect(persona).toMatch(/log_evidence/);
    // D-18: the error is never the drill.
    expect(persona.toLowerCase()).toContain("never make the learner repeat their own error");
  });

  it("yields a clean minimal persona for a fresh learner (no empty scaffolding)", () => {
    const persona = buildTutorPersona({ register: "standard", targetLanguage: "Italian", nativeLanguage: "English" });
    expect(persona).toContain(registerInstruction("standard"));
    expect(persona).not.toMatch(/Recurring mistakes/);
    expect(persona).not.toMatch(/Today's targets/);
  });
});

// The error-flagging mandate. These are PROMPT-CONTENT assertions: they prove the
// instruction we send contains the mandate, the priorities, and the guardrail — they
// cannot prove the model obeys them. Behavioural validation needs a live API key and
// a real Realtime call, which this suite deliberately does not make.
describe("buildTutorPersona — the error-flagging mandate", () => {
  const minimal = () =>
    buildTutorPersona({ register: "colto", targetLanguage: "Italian", nativeLanguage: "English" });

  it("tells the tutor that naming the learner's mistakes is its core job", () => {
    const persona = minimal();
    expect(persona).toContain("Finding and naming the learner's mistakes is your most important job");
    expect(persona.toLowerCase()).toContain("do not politely let errors slide");
  });

  it("makes final-vowel / -o/-a agreement the top-priority error class, with a worked example", () => {
    const persona = minimal();
    expect(persona).toContain("FINAL VOWELS AND AGREEMENT (-o/-a, -i/-e)");
    expect(persona).toContain("highest priority");
    // The final vowel carries gender AND number — the reason this class leads.
    expect(persona).toMatch(/final vowel carries gender and number/);
    // Says what was said and what it should be.
    expect(persona).toContain('you said la ragazzo — it\'s il ragazzo');
    expect(persona).toContain("le case sono belle");
    // A swallowed/centralised ending counts too, not just an outright wrong letter.
    expect(persona.toLowerCase()).toMatch(/swallowed, cut short, or centralised/);
  });

  it("names the other pronunciation errors and grammar/word choice, below final vowels", () => {
    const persona = minimal();
    for (const cue of ["gli", "gn", "DOUBLE CONSONANTS", "geminates", "stress"]) {
      expect(persona).toContain(cue);
    }
    expect(persona.toLowerCase()).toContain("grammar and word-choice errors you are confident about");
    // Priority order is explicit: final vowels are 1, the rest follow.
    expect(persona.indexOf("FINAL VOWELS")).toBeLessThan(persona.indexOf("DOUBLE CONSONANTS"));
  });

  it("carries the never-invent-an-error guardrail (D-19 honesty)", () => {
    const persona = minimal();
    expect(persona).toContain("Never invent an error");
    expect(persona).toContain("If you did not clearly hear it, do not flag it");
    expect(persona.toLowerCase()).toContain("regional or otherwise acceptable variant");
    expect(persona).toContain("A false correction is worse than a missed one");
  });

  it("keeps correction in the flow rather than a nag (D-24 calm, D-18 correction-forward)", () => {
    const persona = minimal();
    expect(persona).toContain("Stay a conversation, not a lecture");
    expect(persona.toLowerCase()).toContain("never stop to teach a mini-lesson after every sentence");
    expect(persona.toLowerCase()).toContain("do not re-drill an error you have already corrected");
    // D-18 still holds alongside the aggressive mandate.
    expect(persona.toLowerCase()).toContain("never make the learner repeat their own error");
  });

  it("composes with the D-23 register dial instead of overriding it", () => {
    for (const register of ["colloquiale", "standard", "colto", "letterario"] as const) {
      const persona = buildTutorPersona({ register, targetLanguage: "Italian", nativeLanguage: "English" });
      // The register line survives verbatim, and the mandate rides alongside it.
      expect(persona).toContain(registerInstruction(register));
      expect(persona).toContain("FINAL VOWELS AND AGREEMENT (-o/-a, -i/-e)");
      expect(persona).toContain("Never invent an error");
      // The register line comes first: the mandate says what is an error, not how to speak.
      expect(persona.indexOf(registerInstruction(register))).toBeLessThan(persona.indexOf("Never invent an error"));
    }
  });
});

describe("logEvidenceTool schema", () => {
  it("declares a function tool with itemId/polarity/mode", () => {
    const tool = logEvidenceTool();
    expect(tool.type).toBe("function");
    expect(tool.name).toBe("log_evidence");
    const props = (tool.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(["itemId", "polarity", "mode"]));
  });
});

describe("buildTutorSessionConfig — the wired config", () => {
  it("ships the tier model, an output voice, the log_evidence tool, and a register-correct instruction", () => {
    const db = freshDb();
    writeSettings(db, { register: "colto", nativeLanguage: "English", realtimeTier: "flagship" });
    const { config } = buildTutorSessionConfig(db);
    expect(config.type).toBe("realtime");
    expect(config.model).toBe(REALTIME_FLAGSHIP);
    expect(config.audio.output.voice).toBeTruthy();
    expect(config.tools.some((t) => t.name === "log_evidence")).toBe(true);
    expect(config.instructions).toContain(registerInstruction("colto"));
    expect(config.instructions).toContain(l1Line("English"));
    // [T2b] the config carries a server-chosen HARD max-duration ceiling (seconds).
    expect(config.maxSessionSeconds).toBeGreaterThan(0);
    db.close();
  });

  it("ships the error-flagging mandate and its guardrail alongside the register line", () => {
    const db = freshDb();
    writeSettings(db, { register: "colto" });
    const { config } = buildTutorSessionConfig(db);
    expect(config.instructions).toContain(registerInstruction("colto"));
    expect(config.instructions).toContain("FINAL VOWELS AND AGREEMENT (-o/-a, -i/-e)");
    expect(config.instructions).toContain("Never invent an error");
    db.close();
  });

  it("follows the tier switch to mini", () => {
    const db = freshDb();
    writeSettings(db, { realtimeTier: "mini" });
    const { config } = buildTutorSessionConfig(db);
    expect(config.model).toBe("gpt-realtime-2.1-mini");
    db.close();
  });
});
