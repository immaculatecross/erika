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
import { MISTAKE_CLASS_LINES } from "@/lib/mistakes";
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

  it("names the register and states ONE coherent rule, distinctly per register", () => {
    const texts = REGISTERS.map((r) => registerInstruction(r));
    for (const r of REGISTERS) expect(registerInstruction(r)).toContain(`"${r}"`);
    // All four are distinct instructions (a real dial, not a constant).
    expect(new Set(texts).size).toBe(REGISTERS.length);

    // [E-42 criterion 12] This assertion used to demand the words "style only, never
    // what is correct" — and it PASSED while the composed deep prompt contradicted
    // itself, because `lib/mistakes.ts` class B, injected a few lines away, told the
    // model a plain register mismatch IS a mistake. A real test asserting the wrong
    // contract (mfactory D-14). The resolved rule, stated once in lib/register.ts:
    // the dial sets the TARGET a slip is judged against, and never overrides
    // grammatical correctness.
    const colto = registerInstruction("colto");
    expect(colto).toMatch(/never overrides what is grammatically correct/i);
    expect(colto).toMatch(/counts as a word-choice mistake/i);
    // And it must no longer make the claim the rest of the prompt disproves.
    expect(colto).not.toMatch(/style only, never what is correct/i);
  });

  it("does not contradict the shared definition of a mistake it is composed with", () => {
    // The two halves land in the SAME prompt (lib/analysis/prompts.ts). Both must
    // agree that a register slip is a real, word-choice-class mistake judged against
    // the chosen register — which is what made the old wording indefensible.
    const classB = MISTAKE_CLASS_LINES.join("\n");
    expect(classB).toMatch(/Register: a word or turn of phrase plainly outside the register/);
    expect(classB).toMatch(/VOCABULARY AND WORD CHOICE/);
    expect(registerInstruction("colto")).toMatch(/word-choice mistake/i);
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
