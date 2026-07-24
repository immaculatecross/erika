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
      realtimeTier: "flagship",
    });
    reopened.close();
  });

  it("persists the realtime tutor tier and rejects an unknown tier (E-34)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    expect(readSettings(db).realtimeTier).toBe("flagship"); // default flagship
    writeSettings(db, { realtimeTier: "mini" });
    db.close();
    const reopened = openDatabase(p);
    expect(readSettings(reopened).realtimeTier).toBe("mini");
    reopened.close();
    expect(() => validateSettings({ realtimeTier: "turbo" })).toThrow(SettingsValidationError);
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
});
