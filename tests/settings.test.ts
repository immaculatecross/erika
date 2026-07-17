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

  it("persists all four fields across a fresh connection (reload)", () => {
    const p = tmpDbPath();
    const db = openDatabase(p);
    writeSettings(db, {
      targetLanguage: "German",
      nativeLanguage: "Spanish",
      modelTier: "deep",
      monthlyBudgetUsd: 40,
    });
    db.close();

    // Fresh connection = simulated reload.
    const reopened = openDatabase(p);
    expect(readSettings(reopened)).toEqual({
      targetLanguage: "German",
      nativeLanguage: "Spanish",
      modelTier: "deep",
      monthlyBudgetUsd: 40,
    });
    reopened.close();
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

  it("rejects an empty language and an unknown model tier", () => {
    expect(() => validateSettings({ targetLanguage: "   " })).toThrow(SettingsValidationError);
    expect(() => validateSettings({ modelTier: "turbo" })).toThrow(SettingsValidationError);
  });
});
