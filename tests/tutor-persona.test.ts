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

  it("follows the tier switch to mini", () => {
    const db = freshDb();
    writeSettings(db, { realtimeTier: "mini" });
    const { config } = buildTutorSessionConfig(db);
    expect(config.model).toBe("gpt-realtime-2.1-mini");
    db.close();
  });
});
