import type { Db } from "./db";
import { REGISTERS, DEFAULT_REGISTER, isRegister, type Register } from "./register";
import { REALTIME_TIERS, type RealtimeTier } from "./analysis/rates";

// The persisted preferences. [RETRO-002 P5] The vestigial `modelTier` (no behavior
// ever hung off it) is REMOVED here — the real tier switch is now the E-34 realtime
// `realtimeTier` (flagship / mini), which drives the tutor's Realtime model.

export interface Settings {
  targetLanguage: string;
  nativeLanguage: string;
  monthlyBudgetUsd: number;
  // The daily composer's new-item caps (E-31, D-19): how many NEW items at the
  // knowledge edge enter each day's plan, per kind. Defaults 10 / 3 / 10 (WO).
  newVocabPerDay: number;
  newRulesPerDay: number;
  newPronPerDay: number;
  // The register dial (E-33, D-23): colloquiale → standard → colto → letterario,
  // default colto. Injected into analysis recasts, lesson generation, TTS voice
  // style, and the E-34 tutor persona (lib/register.ts). Style only, never
  // correctness.
  register: Register;
  // The realtime tutor tier (E-34, WO criterion 2): flagship `gpt-realtime-2.1`
  // (default) or the cheaper `gpt-realtime-2.1-mini`. The one live tier control in
  // the app — it replaces the dead `modelTier` [RETRO-002 P5].
  realtimeTier: RealtimeTier;
}

/** The three new-item-per-day caps that are user-settable — the composer's
 *  per-kind budget (its `dailyMax` ceiling is a composer constant, not a knob). */
export const NEW_ITEM_CAP_KEYS = ["newVocabPerDay", "newRulesPerDay", "newPronPerDay"] as const;

export const DEFAULT_SETTINGS: Settings = {
  targetLanguage: "Italian",
  nativeLanguage: "English",
  // E-28 raises the default cap 25 → 50 to match the richness dial's posture
  // (D-20): short captures are now 100% deep-listened and day dumps triage
  // looser, so the app spends more for the richest picture of the user's speech.
  // A day dump ≈ $1.77 and a 10-min capture ≈ $0.22 (D-20), so $50/mo comfortably
  // covers roughly a dump a day plus short captures. Still user-editable in
  // Settings; the hard cap (E-27 reserve-before-call) makes the spend safe.
  monthlyBudgetUsd: 50,
  newVocabPerDay: 10,
  newRulesPerDay: 3,
  newPronPerDay: 10,
  register: DEFAULT_REGISTER,
  realtimeTier: "flagship",
};

/** Read every preference, filling any unset key from DEFAULT_SETTINGS. */
export function readSettings(db: Db): Settings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const budget = stored.get("monthlyBudgetUsd");
  const capOr = (key: (typeof NEW_ITEM_CAP_KEYS)[number]): number => {
    const v = stored.get(key);
    return v !== undefined ? Number(v) : DEFAULT_SETTINGS[key];
  };
  return {
    targetLanguage: stored.get("targetLanguage") ?? DEFAULT_SETTINGS.targetLanguage,
    nativeLanguage: stored.get("nativeLanguage") ?? DEFAULT_SETTINGS.nativeLanguage,
    monthlyBudgetUsd: budget !== undefined ? Number(budget) : DEFAULT_SETTINGS.monthlyBudgetUsd,
    newVocabPerDay: capOr("newVocabPerDay"),
    newRulesPerDay: capOr("newRulesPerDay"),
    newPronPerDay: capOr("newPronPerDay"),
    register: isRegister(stored.get("register")) ? (stored.get("register") as Register) : DEFAULT_SETTINGS.register,
    realtimeTier: isRealtimeTier(stored.get("realtimeTier"))
      ? (stored.get("realtimeTier") as RealtimeTier)
      : DEFAULT_SETTINGS.realtimeTier,
  };
}

/** Whether a stored/submitted value is a valid realtime tier. */
function isRealtimeTier(x: unknown): x is RealtimeTier {
  return typeof x === "string" && (REALTIME_TIERS as readonly string[]).includes(x);
}

/** Thrown when a submitted value fails validation. Message is user-facing. */
export class SettingsValidationError extends Error {}

/**
 * Validate and coerce an untrusted patch into concrete values. Invalid budgets
 * are rejected with a truthful message, never silently coerced to a default.
 */
export function validateSettings(patch: Record<string, unknown>): Partial<Settings> {
  const out: Partial<Settings> = {};

  for (const key of ["targetLanguage", "nativeLanguage"] as const) {
    if (patch[key] === undefined) continue;
    const v = patch[key];
    if (typeof v !== "string" || v.trim() === "") {
      throw new SettingsValidationError(`${key} must be a non-empty language name.`);
    }
    out[key] = v.trim();
  }

  if (patch.realtimeTier !== undefined) {
    if (!isRealtimeTier(patch.realtimeTier)) {
      throw new SettingsValidationError(`realtimeTier must be one of: ${REALTIME_TIERS.join(", ")}.`);
    }
    out.realtimeTier = patch.realtimeTier;
  }

  if (patch.monthlyBudgetUsd !== undefined) {
    const raw = patch.monthlyBudgetUsd;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isFinite(n) || n < 0) {
      throw new SettingsValidationError("monthlyBudgetUsd must be a number of dollars, 0 or more.");
    }
    out.monthlyBudgetUsd = n;
  }

  for (const key of NEW_ITEM_CAP_KEYS) {
    if (patch[key] === undefined) continue;
    const raw = patch[key];
    const n = typeof raw === "number" ? raw : Number(raw);
    if (typeof raw === "boolean" || raw === "" || raw === null || !Number.isInteger(n) || n < 0) {
      throw new SettingsValidationError(`${key} must be a whole number of items, 0 or more.`);
    }
    out[key] = n;
  }

  if (patch.register !== undefined) {
    if (!isRegister(patch.register)) {
      throw new SettingsValidationError(`register must be one of: ${REGISTERS.join(", ")}.`);
    }
    out.register = patch.register;
  }

  return out;
}

/** Validate `patch`, upsert it, and return the full settings after the write. */
export function writeSettings(db: Db, patch: Record<string, unknown>): Settings {
  const clean = validateSettings(patch);
  const upsert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(clean)) {
      upsert.run(key, String(value));
    }
  });
  tx();
  return readSettings(db);
}
