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
    // The address case turns on the addressee named IN the utterance ("signora"), so
    // it needs no fact about the learner — see the no-gender-inference test below.
    expect(persona).toContain('"signora, è stanco" — it\'s "è stanca"');
    // A swallowed/centralised ending counts too, not just an outright wrong letter.
    expect(persona.toLowerCase()).toMatch(/swallowed, cut short, or centralised/);
    // Definitional, not an unqualified "flag every one" that would beat the per-turn cap.
    expect(persona).toContain("All of these count as real errors, not slips to overlook");
    expect(persona).not.toMatch(/Flag every one/);
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

  // The gender hole: TutorPersonaInput carries no gender field and renderProfileLines
  // (E-19) never emits one, so a self-agreement judgment could only come from a
  // voice-based inference — the model hears perfectly and "corrects" correct speech,
  // which audibility ("did you hear it") cannot catch.
  it("forbids inferring the learner's gender, and gates the self-agreement case on being told", () => {
    const persona = minimal();
    expect(persona).toContain("You are not told the learner's gender and must never infer it from their voice");
    expect(persona).toContain("only treat an ending that disagrees with the speaker themselves as an error if they have told you which form applies to them");
    // The mandate's own example must not require that inference either.
    expect(persona).not.toMatch(/sono stanca/);
    expect(persona).not.toMatch(/male speaker/);
    expect(persona).toContain("but only when they have told you which form applies to them");
  });

  // D-21's evidence transfers: audio LLMs diagnose phones from L1 stereotypes rather
  // than acoustics, which is why the Record deep pass only flags suspects.
  it("yields on sub-phonemic judgments of degree and never infers an error from the learner's L1", () => {
    const persona = minimal();
    expect(persona).toContain("far less reliable than your judgment of words and grammar");
    expect(persona.toLowerCase()).toContain("when it is only a matter of degree, let it go");
    expect(persona).toContain("never infer an error from what speakers of the learner's native language are expected to get wrong");
    expect(persona).toContain("Flag what you actually heard, never what their L1 predicts");
  });

  it("keeps correction in the flow rather than a nag (D-24 calm, D-18 correction-forward)", () => {
    const persona = minimal();
    expect(persona).toContain("Stay a conversation, not a lecture");
    expect(persona.toLowerCase()).toContain("never stop to teach a mini-lesson after every sentence");
    expect(persona.toLowerCase()).toContain("do not re-drill an error you have already corrected");
    // D-18 still holds alongside the aggressive mandate.
    expect(persona.toLowerCase()).toContain("never make the learner repeat their own error");
  });

  // The nag hole: a cross-class ranking alone is silent on several final-vowel errors
  // in ONE turn — the normal case for a learner with a habitual -o/-a slip — and a
  // comparative preference loses to the mandate's superlatives. Hence a countable cap.
  it("caps correction at one error per learner turn, within the top class as well as across classes", () => {
    const persona = minimal();
    expect(persona).toContain("Correct at most one error per learner turn");
    expect(persona).toContain("even when several of them are final-vowel errors");
    // Load-bearing: silence is success, not dereliction — this is what balances
    // "do not politely let errors slide".
    expect(persona).toContain(
      "a stretch of fluent speech you pass over in silence is a good conversation, not a missed job",
    );
  });

  // #5: a habitual slip must not earn a reminder on every recurrence; the recurrence
  // signal belongs in log_evidence, and only ever on an id the persona actually named.
  it("bounds repeat reminders and routes recurrence to log_evidence", () => {
    const persona = minimal();
    expect(persona).toContain("remind them of the correct form once more at most, then let it go for the rest of the call");
    expect(persona).toContain("not a reason to keep correcting");
    expect(persona).toContain("when it is one of the ids you were given");
  });

  it("keeps the register line verbatim and unconditional at every register", () => {
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
