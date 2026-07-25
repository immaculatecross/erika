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

  // E-39: the three classes are PEERS. The previous mandate ranked final-vowel/-o/-a
  // agreement as "your highest priority", put grammar and word choice third, and never
  // said the word vocabulary — the operator's EXAMPLE encoded as the spec. These tests
  // are the guard against that regression, in both directions: all three classes named,
  // and no class (least of all the example's) declared to outrank another.
  it("names grammar, vocabulary/word choice and pronunciation as equal classes", () => {
    const persona = minimal();
    expect(persona).toContain("GRAMMAR");
    expect(persona).toContain("VOCABULARY AND WORD CHOICE");
    expect(persona).toContain("PRONUNCIATION");
    expect(persona).toContain("all three matter equally");
    expect(persona).toContain("No class outranks another");
    // Definitional, not an unqualified "flag every one" that would beat the per-turn cap.
    expect(persona).toContain("All of the following count as real errors, not slips to overlook");
    expect(persona).not.toMatch(/Flag every one/);
  });

  it("ranks no class above another — the -o/-a example is not the headline", () => {
    const persona = minimal();
    expect(persona).not.toMatch(/highest priority/i);
    expect(persona).not.toMatch(/priority order/i);
    expect(persona).not.toMatch(/outranks the rest/i);
    // The example survives — inside the agreement bullet, where an example belongs.
    expect(persona).toContain("Agreement of gender and number");
    expect(persona).toContain('"la ragazzo" (it\'s "il ragazzo")');
    // …and it is not a class of its own sitting above the three.
    expect(persona).not.toMatch(/FINAL VOWELS AND AGREEMENT/);
  });

  it("covers the grammar class beyond agreement: tense/mood, auxiliary, prepositions, clitics, word order", () => {
    const persona = minimal();
    // Agreement, with the -o/-a worked example and the address case (which turns on the
    // addressee named IN the utterance, so it needs no fact about the learner).
    expect(persona).toContain("le case sono belle");
    expect(persona).toContain('"signora, è stanco" (it\'s "è stanca")');
    expect(persona.toLowerCase()).toMatch(/swallowed, cut short, or centralised/);
    // Tense, mood and aspect — congiuntivo, condizionale, passato prossimo/imperfetto.
    expect(persona).toContain("penso che sia vero");
    expect(persona).toContain("se avessi tempo, verrei");
    expect(persona).toContain("ieri sono andato al cinema");
    // Auxiliary choice.
    expect(persona).toContain('"ho andato" — "sono andato"');
    // Articles and prepositions, including the articulated form and the choice itself.
    expect(persona).toContain('"il studente" — "lo studente"');
    expect(persona).toContain("vado in Italia");
    expect(persona).toContain("dipende da");
    // Clitics and pronouns.
    expect(persona).toContain('"lo telefono" — "gli telefono"');
    expect(persona).toContain("glielo");
    // Word order and negation.
    expect(persona).toContain("non ho visto niente");
  });

  it("covers the vocabulary class: wrong word, false friends, calques, collocation, lexical gender, register", () => {
    const persona = minimal();
    expect(persona).toContain("the grammar is intact but the word is wrong");
    expect(persona).toContain("says something the learner did not mean");
    // False friends, named with what they actually mean.
    expect(persona).toContain("attualmente");
    expect(persona).toContain("eventualmente");
    expect(persona).toContain("libreria");
    // A calque, and a collocation error.
    expect(persona).toContain('"fare una decisione" — "prendere una decisione"');
    expect(persona).toContain("sostenere un esame");
    // Lexical gender — a fact about the word, distinct from the agreement rule.
    expect(persona).toContain('"la problema" — "il problema"');
    // D-23: a register slip is a real mistake, judged against the learner's dial.
    expect(persona).toContain("plainly outside the register named above");
    expect(persona).toContain("never against your own preference");
  });

  it("covers the pronunciation class it already had, plus s/z and the blurred ending", () => {
    const persona = minimal();
    for (const cue of ["geminates", "gli", "gn", "the Italian r", "misplaced stress", "schwa"]) {
      expect(persona).toContain(cue);
    }
    expect(persona).toContain("fato against fatto");
    expect(persona).toContain("voiced against voiceless s and z");
    expect(persona).toContain("a final vowel blurred until the ending is lost");
    // The class is still gated on actually hearing it.
    expect(persona).toContain("when you actually hear one go wrong");
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
    expect(persona).toContain(
      "an ending that disagrees with the SPEAKER themselves counts only when they have told you which form applies to them",
    );
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
  it("caps correction at one error per learner turn, within a class as well as across classes", () => {
    const persona = minimal();
    expect(persona).toContain("Correct at most one error per learner turn");
    expect(persona).toContain("even when several of them are of the same kind");
    // The tie-break is class-neutral now: it used to say a final-vowel error "outranks
    // the rest", which would pass over a meaning-changing false friend for a blurred -o.
    expect(persona).toContain("whichever of the three classes it belongs to");
    expect(persona).toContain("most gets in the way of being understood");
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
      expect(persona).toContain("VOCABULARY AND WORD CHOICE");
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
  it("ships the pinned model, TEXT-ONLY output, server VAD, the log_evidence tool, and a register-correct instruction", () => {
    const db = freshDb();
    writeSettings(db, { register: "colto", nativeLanguage: "English" });
    const { config } = buildTutorSessionConfig(db);
    expect(config.type).toBe("realtime");
    expect(config.model).toBe(REALTIME_FLAGSHIP);
    // [E-43 / D-28] audio in, TEXT out — the whole architecture of this milestone.
    expect(config.output_modalities).toEqual(["text"]);
    // Turn-taking is server VAD with automatic responses, so the learner presses
    // nothing between turns (criterion 1) and can talk over the tutor.
    expect(config.audio.input.turn_detection.type).toBe("server_vad");
    expect(config.audio.input.turn_detection.create_response).toBe(true);
    expect(config.audio.input.turn_detection.interrupt_response).toBe(true);
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
    expect(config.instructions).toContain("VOCABULARY AND WORD CHOICE");
    expect(config.instructions).toContain("No class outranks another");
    expect(config.instructions).toContain("Never invent an error");
    db.close();
  });

  it("pins the flagship listening model regardless of what Settings holds (E-43)", () => {
    // The realtimeTier knob is gone: spike-6 measured gpt-realtime-2.1-mini producing
    // 3 empty replies and 2 hallucinated errors on clean speech out of 9 fixtures, so
    // a learner-facing choice between "works" and "invents corrections" was removed.
    // A database that still holds the old key must not resurrect it.
    const db = freshDb();
    db.prepare("INSERT INTO settings (key, value) VALUES ('realtimeTier', 'mini')").run();
    const { config } = buildTutorSessionConfig(db);
    expect(config.model).toBe(REALTIME_FLAGSHIP);
    db.close();
  });
});
