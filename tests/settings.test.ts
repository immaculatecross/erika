import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "@/lib/db";
import {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  validateSettings,
  SettingsValidationError,
} from "@/lib/settings";
import { ACTIVE_NEW_ITEM_KNOBS, PENDING_NEW_ITEM_KNOBS } from "@/lib/settings-knobs";

const dirs: string[] = [];

function tmpDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "erika-set-"));
  dirs.push(dir);
  return path.join(dir, "erika.db");
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("settings persistence", () => {
  it("returns defaults on an empty database", () => {
    const db = openDatabase(tmpDbPath());
    expect(readSettings(db)).toEqual(DEFAULT_SETTINGS);
    db.close();
  });

  it("persists the core fields across a fresh connection (reload)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    writeSettings(db, {
      targetLanguage: "German",
      nativeLanguage: "Spanish",
      monthlyBudgetUsd: 40,
    });
    db.close();

    // Fresh connection = simulated reload. Unset keys fall back to their defaults
    // (the E-31 new-item caps, the E-33 register, the E-34 realtime tier were not
    // written here). [RETRO-002 P5] the dead `modelTier` control is gone entirely.
    const reopened = openDatabase(p);
    expect(readSettings(reopened)).toEqual({
      targetLanguage: "German",
      nativeLanguage: "Spanish",
      monthlyBudgetUsd: 40,
      newVocabPerDay: 10,
      newRulesPerDay: 3,
      newPronPerDay: 10,
      register: "colto",
      tutorVoice: "female",
      tutorMinMinutes: 5,
    });
    reopened.close();
  });

  it("persists the tutor voice and rejects an unknown one (E-43)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    expect(readSettings(db).tutorVoice).toBe("female"); // default: the product is Erika
    writeSettings(db, { tutorVoice: "male" });
    db.close();
    const reopened = openDatabase(p);
    expect(readSettings(reopened).tutorVoice).toBe("male");
    reopened.close();
    expect(() => validateSettings({ tutorVoice: "marin" })).toThrow(SettingsValidationError);
  });

  it("persists the conversation minimum and rejects a nonsense one (E-43)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    expect(readSettings(db).tutorMinMinutes).toBe(5);
    writeSettings(db, { tutorMinMinutes: 8 });
    db.close();
    const reopened = openDatabase(p);
    expect(readSettings(reopened).tutorMinMinutes).toBe(8);
    reopened.close();
    expect(() => validateSettings({ tutorMinMinutes: -1 })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ tutorMinMinutes: "soon" })).toThrow(SettingsValidationError);
  });

  it("a database that stored the REMOVED realtimeTier still reads (E-43 criterion 10)", () => {
    // Deleting a Settings key must not break readSettings for a database that has one.
    // A stored key nobody selects is inert, and every other preference survives it.
    const p = tmpDbPath();
    const db = openDatabase(p);
    db.prepare("INSERT INTO settings (key, value) VALUES ('realtimeTier', 'mini')").run();
    writeSettings(db, { register: "standard" });
    const s = readSettings(db);
    expect(s.register).toBe("standard");
    expect(s.tutorVoice).toBe("female");
    expect((s as unknown as Record<string, unknown>).realtimeTier).toBeUndefined();
    db.close();
  });

  it("no longer knows the removed modelTier control [RETRO-002 P5]", () => {
    // The dead control is gone: a stray modelTier patch is simply ignored (not a
    // validation error, not a persisted field), and readSettings has no such key.
    const db = openDatabase(tmpDbPath());
    const saved = writeSettings(db, { modelTier: "deep" } as Record<string, unknown>);
    expect("modelTier" in saved).toBe(false);
    db.close();
  });

  it("persists the register dial across a reload and rejects an unknown register (E-33)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    expect(readSettings(db).register).toBe("colto"); // default colto (D-23)
    writeSettings(db, { register: "letterario" });
    db.close();
    const reopened = openDatabase(p);
    expect(readSettings(reopened).register).toBe("letterario");
    reopened.close();
    expect(() => validateSettings({ register: "aulico" })).toThrow(SettingsValidationError);
  });

  it("coerces a numeric-string budget but keeps the number type", () => {
    const db = openDatabase(tmpDbPath());
    const saved = writeSettings(db, { monthlyBudgetUsd: "12.5" });
    expect(saved.monthlyBudgetUsd).toBe(12.5);
    db.close();
  });

  it("rejects an invalid budget instead of silently coercing", () => {
    expect(() => validateSettings({ monthlyBudgetUsd: "abc" })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ monthlyBudgetUsd: -5 })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ monthlyBudgetUsd: "" })).toThrow(SettingsValidationError);
  });

  it("rejects an empty language", () => {
    expect(() => validateSettings({ targetLanguage: "   " })).toThrow(SettingsValidationError);
  });

  it("validates the new-item-per-day caps as whole non-negative numbers (E-31)", () => {
    const db = openDatabase(tmpDbPath());
    const saved = writeSettings(db, { newVocabPerDay: "12", newRulesPerDay: 0, newPronPerDay: 5 });
    expect(saved.newVocabPerDay).toBe(12); // numeric string coerced, type kept
    expect(saved.newRulesPerDay).toBe(0);
    expect(saved.newPronPerDay).toBe(5);
    db.close();
    expect(() => validateSettings({ newVocabPerDay: -1 })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ newRulesPerDay: 2.5 })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ newPronPerDay: "abc" })).toThrow(SettingsValidationError);
  });

  it("[E-37] every new-item cap is a live control — the Sounds knob is no longer inert", () => {
    const activeKeys = ACTIVE_NEW_ITEM_KNOBS.map((k) => k.key);
    expect(activeKeys).toContain("newVocabPerDay");
    expect(activeKeys).toContain("newRulesPerDay");
    // [P3a → E-37] "Sounds" was withheld only because nothing ever created a `phone:`
    // item, so the cap could never yield one. The pronunciation studio seeds phones
    // from real drill results and surfaces the composer's selection of them, so the
    // knob now governs something that exists — and is presented as the live control
    // it became, with nothing left pending.
    expect(activeKeys).toContain("newPronPerDay");
    expect(PENDING_NEW_ITEM_KNOBS).toEqual([]);
  });
});
