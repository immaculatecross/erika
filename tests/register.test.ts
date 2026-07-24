import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import { writeSettings, readSettings } from "@/lib/settings";
import {
  REGISTERS,
  DEFAULT_REGISTER,
  registerInstruction,
  registerTtsInstruction,
  coerceRegister,
  type Register,
} from "@/lib/register";
import { grammarLessonPrompt, vocabLessonPrompt, lessonRegister } from "@/lib/lessons/item-lessons";
import { deepPrompt, recastRegisterInstruction } from "@/lib/analysis/prompts";
import { buildTutorPersona } from "@/lib/tutor/persona";
import type { SyllabusRule } from "@/lib/syllabus/types";

// E-33 criterion 1: the register dial (D-23) reaches EVERY generation surface —
// analysis recasts, lesson generation, TTS instructions, and the documented E-34
// tutor-persona hook — a fixture per surface. The dial changes style/register only:
// each register yields a distinct instruction, and it is injected, never hard-coded.

const dirs: string[] = [];
function freshDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-register-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "erika.db"));
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const RULE: SyllabusRule = {
  key: "congiuntivo-presente",
  cefr: "B2",
  area: "verbi",
  title: "Congiuntivo presente",
  description: "Il congiuntivo dopo verbi di opinione.",
  prereqs: [],
  examples: ["Penso che sia giusto."],
};

describe("the register instruction itself", () => {
  it("defaults to colto and covers the whole D-23 ladder", () => {
    expect(DEFAULT_REGISTER).toBe("colto");
    expect(REGISTERS).toEqual(["colloquiale", "standard", "colto", "letterario"]);
  });

  it("names the register and pins to style, distinctly per register", () => {
    const texts = REGISTERS.map((r) => registerInstruction(r));
    for (const r of REGISTERS) expect(registerInstruction(r)).toContain(`"${r}"`);
    // All four are distinct instructions (a real dial, not a constant).
    expect(new Set(texts).size).toBe(REGISTERS.length);
    // It is a STYLE steer, not a correctness one.
    expect(registerInstruction("colto")).toMatch(/style only, never what is correct/i);
  });

  it("coerces an unknown value to the default", () => {
    expect(coerceRegister("aulico")).toBe(DEFAULT_REGISTER);
    expect(coerceRegister("letterario")).toBe("letterario");
  });
});

describe("surface 1 — lesson generation carries the dial", () => {
  it("the grammar prompt injects the given register", () => {
    for (const r of REGISTERS) {
      expect(grammarLessonPrompt("Italian", r, RULE)).toContain(registerInstruction(r));
    }
  });
  it("the vocab prompt injects the given register", () => {
    for (const r of REGISTERS) {
      expect(vocabLessonPrompt("Italian", r, "magari", "ADV")).toContain(registerInstruction(r));
    }
  });
  it("lesson generation reads the register from Settings", () => {
    const db = freshDb();
    expect(lessonRegister(db)).toBe("colto"); // default (D-23)
    writeSettings(db, { register: "letterario" });
    expect(lessonRegister(db)).toBe("letterario");
    db.close();
  });
});

describe("surface 2 — analysis recasts carry the dial", () => {
  it("the deep prompt injects the correction-voice register", () => {
    for (const r of REGISTERS) {
      expect(deepPrompt("Italian", undefined, r)).toContain(recastRegisterInstruction(r));
    }
    // Recast instruction ties the register to the correction voice specifically.
    expect(recastRegisterInstruction("colto")).toMatch(/recast/i);
  });
});

describe("surface 3 — TTS instructions carry the dial", () => {
  it("each register yields a distinct spoken-delivery instruction", () => {
    const texts = REGISTERS.map((r) => registerTtsInstruction(r));
    expect(new Set(texts).size).toBe(REGISTERS.length);
    for (const t of texts) expect(t).toMatch(/Italian/);
  });
});

describe("surface 4 — the tutor persona hook receives the dial (E-34 slot)", () => {
  it("builds a persona that carries the register instruction", () => {
    for (const r of REGISTERS as readonly Register[]) {
      const persona = buildTutorPersona({ register: r, targetLanguage: "Italian", nativeLanguage: "English" });
      expect(persona).toContain(registerInstruction(r));
    }
  });
});

describe("changing the dial changes style only, never the persisted correctness path", () => {
  it("the register is a Settings value, independent of language/budget", () => {
    const db = freshDb();
    writeSettings(db, { register: "colloquiale", targetLanguage: "Italian", monthlyBudgetUsd: 30 });
    const s = readSettings(db);
    expect(s.register).toBe("colloquiale");
    expect(s.targetLanguage).toBe("Italian");
    expect(s.monthlyBudgetUsd).toBe(30);
    db.close();
  });
});
